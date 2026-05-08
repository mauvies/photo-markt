'use server';

import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { activityValues } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import {
  createPhoto,
  deletePhoto as dbDeletePhoto,
  deleteStorageFiles,
  eventExists,
  getEvent,
  getPhoto,
  updateEvent,
  uploadFile,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { validatePhotoUpload } from '@/lib/photo-upload';

// --- Constants ---

const SHARE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

// --- Schema ---

const eventSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  activity: z
    .string()
    .min(1, 'Activity is required.')
    .refine(
      (value): value is (typeof activityValues)[number] =>
        activityValues.includes(value as (typeof activityValues)[number]),
      'Activity is required.',
    ),
  date: z.string().min(1, 'Date is required.'),
  country: z.string().trim().optional().default(''),
  state: z.string().trim().optional().default(''),
  city: z.string().trim().optional(),
  is_public: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  watermark_enabled: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  is_collaborative: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  allow_guest_upload: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),
  require_upload_approval: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  price_per_photo: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === '') return null;
      const num = Number.parseFloat(val);
      return Number.isNaN(num) || num < 0 ? null : num;
    }),
});

// --- Types ---

type EventPayload = z.infer<typeof eventSchema>;
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// --- Helpers ---

function generateShareCode(): string {
  return Array.from({ length: SHARE_CODE_LENGTH }, () =>
    SHARE_CODE_CHARSET.charAt(Math.floor(Math.random() * SHARE_CODE_CHARSET.length)),
  ).join('');
}

function buildPhotoPath(userId: string, eventId: string, extension: string): string {
  return `${userId}/${eventId}/${crypto.randomUUID()}.${extension}`;
}

async function uploadPhotos(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  files: File[],
  date: string,
  location: { city: string; country: string; state: string },
): Promise<void> {
  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      const validated = await validatePhotoUpload(file);
      const path = buildPhotoPath(userId, eventId, validated.extension);
      await uploadFile(supabase, 'photos', path, validated.buffer, {
        contentType: validated.contentType,
        upsert: false,
      });
      await createPhoto(supabase, userId, {
        event_id: eventId,
        original_url: path,
        taken_at: new Date(date).toISOString(),
        city: location.city,
        country: location.country,
        state: location.state,
        size_bytes: file.size,
      });
      uploadedPaths.push(path);
    }
  } catch (error) {
    console.error('Photo upload failed', error);
    if (uploadedPaths.length > 0) {
      await deleteStorageFiles(supabase, 'photos', uploadedPaths);
    }
    throw error;
  }
}

function revalidateAfterEventMutation(userId: string, eventId: string): void {
  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/es/dashboard/photographer/events/${eventId}/edit`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}/edit`);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  revalidateTag(`event-${eventId}`, 'max');
  revalidateTag(`photographer-events-${userId}`, 'max');
  revalidateTag(`dashboard-photographer-${userId}`, 'max');
  updateTag(`event-${eventId}`);
  updateTag(`photographer-events-${userId}`);
}

// --- Exports ---

/**
 * Update event metadata, optionally add new photos and/or delete existing ones.
 */
export async function updateEventAction(
  eventId: string,
  formData: FormData,
  photoFormData?: FormData,
  photoIdsToDelete?: string[],
): Promise<{ success: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to update an event.');
  }

  const parsed = eventSchema.safeParse({
    name: formData.get('name')?.toString() ?? '',
    activity: formData.get('activity')?.toString() ?? '',
    date: formData.get('date')?.toString() ?? '',
    country: formData.get('country')?.toString() ?? '',
    state: formData.get('state')?.toString(),
    city: formData.get('city')?.toString(),
    is_public: formData.get('is_public')?.toString() ?? 'true',
    watermark_enabled: formData.get('watermark_enabled')?.toString() ?? 'true',
    is_collaborative: formData.get('is_collaborative')?.toString() ?? 'false',
    allow_guest_upload: formData.get('allow_guest_upload')?.toString() ?? 'true',
    require_upload_approval: formData.get('require_upload_approval')?.toString() ?? 'false',
    price_per_photo: formData.get('price_per_photo')?.toString(),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid event data provided.');
  }

  const payload: EventPayload = parsed.data;

  const currentEvent = await getEvent(supabase, eventId, user.id);
  if (!currentEvent) throw new Error('Event not found.');

  // Collaborative events always need a share code (that's the entry point for
  // contributors). Public non-collaborative events don't.
  let shareCode: string | null = currentEvent.share_code;
  if (payload.is_collaborative || !payload.is_public) {
    if (!shareCode) shareCode = generateShareCode();
  } else {
    shareCode = null;
  }

  const watermarkEnabled = payload.is_public && payload.watermark_enabled;

  await updateEvent(supabase, eventId, user.id, {
    name: payload.name,
    activity: payload.activity,
    date: payload.date,
    country: payload.country,
    state: payload.state,
    city: payload.city || '',
    is_public: payload.is_public,
    share_code: shareCode,
    price_per_photo: payload.price_per_photo ?? null,
    watermark_enabled: watermarkEnabled,
    is_collaborative: payload.is_collaborative,
    allow_guest_upload: payload.allow_guest_upload,
    require_upload_approval: payload.require_upload_approval,
  });

  if (photoIdsToDelete && photoIdsToDelete.length > 0) {
    for (const photoId of photoIdsToDelete) {
      const photo = await getPhoto(supabase, photoId, eventId, user.id);
      if (photo) {
        await dbDeletePhoto(supabase, photoId, user.id);
        if (photo.original_url) {
          await deleteStorageFiles(supabase, 'photos', [photo.original_url]);
        }
      }
    }
  }

  if (photoFormData) {
    const uploadedFiles = photoFormData
      .getAll('photos')
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (uploadedFiles.length > 0) {
      await uploadPhotos(supabase, user.id, eventId, uploadedFiles, payload.date, {
        city: payload.city || '',
        country: payload.country,
        state: payload.state,
      });
    }
  }

  revalidateAfterEventMutation(user.id, eventId);
  revalidateTag('filter-options', 'max');

  return { success: true };
}

/**
 * Delete a single photo from an event.
 */
export async function deletePhotoAction(photoId: string, eventId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to delete a photo.');
  }

  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }

  const photo = await getPhoto(supabase, photoId, eventId, user.id);
  if (!photo) throw new Error('Photo not found.');

  await dbDeletePhoto(supabase, photoId, user.id);

  if (photo.original_url) {
    await deleteStorageFiles(supabase, 'photos', [photo.original_url]);
  }

  revalidateAfterEventMutation(user.id, eventId);
}

/**
 * Add new photos to an existing event.
 */
export async function addPhotosAction(eventId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to add photos.');
  }

  const event = await getEvent(supabase, eventId, user.id);
  if (!event) throw new Error('Event not found or access denied.');

  const uploadedFiles = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (uploadedFiles.length === 0) throw new Error('No photos provided.');

  await uploadPhotos(supabase, user.id, event.id, uploadedFiles, event.date, {
    city: event.city,
    country: event.country,
    state: event.state || '',
  });

  revalidateAfterEventMutation(user.id, eventId);
}
