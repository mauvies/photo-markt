'use server';

import { Buffer } from 'node:buffer';
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import {
  createPhoto,
  createEvent as dbCreateEvent,
  deleteEvent,
  deleteEventPhotos,
  deleteStorageFiles,
  uploadFile,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { generateEventSlug } from '@/lib/slugify';
import { activityValues } from './activity-options';

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

export type CreateEventResult = {
  eventId: string;
  shareCode: string | null;
};

// --- Helpers ---

function generateShareCode(): string {
  return Array.from({ length: SHARE_CODE_LENGTH }, () =>
    SHARE_CODE_CHARSET.charAt(Math.floor(Math.random() * SHARE_CODE_CHARSET.length)),
  ).join('');
}

function buildPhotoPath(userId: string, eventId: string, file: File): string {
  const fileId = crypto.randomUUID();
  const extension = file.name.split('.').pop();
  const safeName = extension ? `${fileId}.${extension.toLowerCase()}` : fileId;
  return `${userId}/${eventId}/${safeName}`;
}

async function resolvePublicEventSlug(
  supabase: SupabaseClient,
  name: string,
  city: string,
  date: string,
  eventId: string,
): Promise<string> {
  const year = new Date(date).getFullYear();
  const baseSlug = generateEventSlug(name, city, year);
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('slug', baseSlug)
    .maybeSingle();
  return existing ? generateEventSlug(name, city, year, eventId.slice(0, 6)) : baseSlug;
}

async function uploadEventPhotos(
  supabase: SupabaseClient,
  userId: string,
  event: { id: string },
  files: File[],
  payload: Pick<EventPayload, 'date' | 'city' | 'country' | 'state'>,
): Promise<void> {
  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      const path = buildPhotoPath(userId, event.id, file);
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadFile(supabase, 'photos', path, buffer, {
        contentType: file.type || undefined,
        upsert: false,
      });
      await createPhoto(supabase, userId, {
        event_id: event.id,
        original_url: path,
        taken_at: new Date(payload.date).toISOString(),
        city: payload.city || '',
        country: payload.country,
        state: payload.state || null,
      });
      uploadedPaths.push(path);
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await deleteStorageFiles(supabase, 'photos', uploadedPaths);
    }
    throw error;
  }
}

async function revalidateAfterEventCreate(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<void> {
  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  revalidateTag('filter-options', 'max');
  revalidateTag(`photographer-events-${userId}`, 'max');
  revalidateTag(`dashboard-photographer-${userId}`, 'max');
  updateTag(`photographer-events-${userId}`);
  updateTag(`dashboard-photographer-${userId}`);

  const { data: profile } = await supabase
    .from('profiles')
    .select('slug')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.slug) revalidateTag(`photographer-${profile.slug}`, 'max');
}

// --- Export ---

/**
 * Create a new event with photos from the given form data.
 * Private events receive a random share code; public events get a SEO slug.
 */
export const createEvent = async (formData: FormData): Promise<CreateEventResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to create an event.');

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

  const payload = parsed.data;
  const uploadedFiles = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
  // Collaborative events can be created without any initial photos because
  // the whole point is for others to contribute through the share link.
  if (!payload.is_collaborative && uploadedFiles.length === 0) {
    throw new Error('Add at least one photo to continue.');
  }

  // Collaborative events are inherently shared by code, so always issue one.
  const shareCode = payload.is_public && !payload.is_collaborative ? null : generateShareCode();
  const watermarkEnabled = payload.is_public && payload.watermark_enabled;

  const event = await dbCreateEvent(supabase, user.id, {
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
    slug: null,
  });

  if (payload.is_public) {
    const slug = await resolvePublicEventSlug(
      supabase,
      payload.name,
      payload.city || '',
      payload.date,
      event.id,
    );
    await supabase.from('events').update({ slug }).eq('id', event.id).eq('user_id', user.id);
  }

  if (uploadedFiles.length > 0) {
    try {
      await uploadEventPhotos(supabase, user.id, event, uploadedFiles, payload);
    } catch (error) {
      console.error('createEvent: upload failed', error);
      await deleteEventPhotos(supabase, event.id, user.id);
      await deleteEvent(supabase, event.id, user.id);
      throw new Error(
        error instanceof Error ? error.message : 'Unable to upload photos. Please try again.',
      );
    }
  }

  await revalidateAfterEventCreate(supabase, user.id, event.id);

  return { eventId: event.id, shareCode };
};
