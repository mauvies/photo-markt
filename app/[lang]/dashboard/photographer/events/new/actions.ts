'use server';

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
import { getStorageUsageBytes } from '@/database/queries/photos';
import { getCurrentPlan } from '@/database/queries/subscriptions';
import { createClient } from '@/database/server';
import { validatePhotoUpload } from '@/lib/photo-upload';
import {
  assertCanCreateEvent,
  assertCanUploadPhoto,
  isPlanLimitError,
  PlanLimitError,
} from '@/lib/plan-limits';
import { generateEventSlug } from '@/lib/slugify';
import { activityValues } from './activity-options';

// --- Constants ---

const SHARE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

// --- Schema ---

const dollarsToCents = (val: string | undefined): number | null => {
  if (!val || val.trim() === '') return null;
  const num = Number.parseFloat(val);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
};

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
  event_type: z.enum(['solo', 'collaborative', 'organizer']).default('solo'),
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
  organizer_fee_per_photo: z.string().optional(),
});

// --- Types ---

type EventPayload = z.infer<typeof eventSchema>;
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type UploadSkippedReason = 'storage_limit';

export type CreateEventResult = {
  eventId: string;
  shareCode: string | null;
  uploaded: number;
  skipped: Array<{ name: string; reason: UploadSkippedReason }>;
};

type UploadEventPhotosResult = {
  uploaded: number;
  skipped: Array<{ name: string; reason: UploadSkippedReason }>;
};

// --- Helpers ---

function generateShareCode(): string {
  return Array.from({ length: SHARE_CODE_LENGTH }, () =>
    SHARE_CODE_CHARSET.charAt(Math.floor(Math.random() * SHARE_CODE_CHARSET.length)),
  ).join('');
}

function buildPhotoPath(userId: string, eventId: string, extension: string): string {
  const fileId = crypto.randomUUID();
  const safeName = `${fileId}.${extension}`;
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
): Promise<UploadEventPhotosResult> {
  // Pre-fetch the user's current storage once; the loop mutates this local
  // total instead of re-querying per file.
  let currentUsage = await getStorageUsageBytes(supabase, userId);
  const uploadedPaths: string[] = [];
  const skipped: UploadEventPhotosResult['skipped'] = [];
  let uploaded = 0;

  try {
    for (const file of files) {
      const validated = await validatePhotoUpload(file);
      const fileSize = validated.buffer.length;
      try {
        await assertCanUploadPhoto(supabase, userId, fileSize, currentUsage);
      } catch (err) {
        if (isPlanLimitError(err)) {
          skipped.push({ name: file.name, reason: 'storage_limit' });
          continue;
        }
        throw err;
      }

      const path = buildPhotoPath(userId, event.id, validated.extension);
      await uploadFile(supabase, 'photos', path, validated.buffer, {
        contentType: validated.contentType,
        upsert: false,
      });
      await createPhoto(supabase, userId, {
        event_id: event.id,
        original_url: path,
        taken_at: new Date(payload.date).toISOString(),
        city: payload.city || '',
        country: payload.country,
        state: payload.state || null,
        size_bytes: fileSize,
      });
      uploadedPaths.push(path);
      currentUsage += fileSize;
      uploaded += 1;
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await deleteStorageFiles(supabase, 'photos', uploadedPaths);
    }
    throw error;
  }

  return { uploaded, skipped };
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

  // Plan ceiling — throws PlanLimitError (typed) which the UI surfaces as an
  // upgrade prompt. Server-side enforcement; the wizard entry page also
  // redirects at-limit users away as a UX nicety.
  await assertCanCreateEvent(supabase, user.id);

  const parsed = eventSchema.safeParse({
    name: formData.get('name')?.toString() ?? '',
    activity: formData.get('activity')?.toString() ?? '',
    date: formData.get('date')?.toString() ?? '',
    country: formData.get('country')?.toString() ?? '',
    state: formData.get('state')?.toString(),
    city: formData.get('city')?.toString(),
    event_type: formData.get('event_type')?.toString() ?? 'solo',
    is_public: formData.get('is_public')?.toString() ?? 'true',
    watermark_enabled: formData.get('watermark_enabled')?.toString() ?? 'true',
    is_collaborative: formData.get('is_collaborative')?.toString() ?? 'false',
    allow_guest_upload: formData.get('allow_guest_upload')?.toString() ?? 'true',
    require_upload_approval: formData.get('require_upload_approval')?.toString() ?? 'false',
    price_per_photo: formData.get('price_per_photo')?.toString(),
    organizer_fee_per_photo: formData.get('organizer_fee_per_photo')?.toString(),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid event data provided.');
  }

  const payload = parsed.data;
  const eventType = payload.event_type;
  // Force the legacy boolean to mirror the new event_type. Organizer events
  // never set is_collaborative=true; they have their own membership model.
  const isCollaborative = eventType === 'collaborative';
  // Organizer events are always private (membership-gated) and have no public
  // share code — access is via the event_photographers join table.
  const isPublic = eventType === 'organizer' ? false : payload.is_public;

  const uploadedFiles = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
  // Solo events require at least one initial photo. Collaborative + organizer
  // both expect contributions to arrive after creation.
  if (eventType === 'solo' && uploadedFiles.length === 0) {
    throw new Error('Add at least one photo to continue.');
  }

  // Public solo events use a SEO slug; everything else needs a share code
  // (collaborative) or has no public access at all (organizer).
  const shareCode =
    eventType === 'organizer' ? null : isPublic && !isCollaborative ? null : generateShareCode();
  const watermarkEnabled =
    eventType === 'organizer' ? payload.watermark_enabled : isPublic && payload.watermark_enabled;

  const organizerFeeCents =
    eventType === 'organizer' ? dollarsToCents(payload.organizer_fee_per_photo) : null;

  const event = await dbCreateEvent(supabase, user.id, {
    name: payload.name,
    activity: payload.activity,
    date: payload.date,
    country: payload.country,
    state: payload.state,
    city: payload.city || '',
    is_public: isPublic,
    share_code: shareCode,
    price_per_photo: eventType === 'organizer' ? null : (payload.price_per_photo ?? null),
    watermark_enabled: watermarkEnabled,
    is_collaborative: isCollaborative,
    allow_guest_upload: eventType === 'collaborative' ? payload.allow_guest_upload : false,
    require_upload_approval: payload.require_upload_approval,
    type: eventType,
    organizer_fee_per_photo_cents: organizerFeeCents,
    slug: null,
  });

  if (isPublic) {
    const slug = await resolvePublicEventSlug(
      supabase,
      payload.name,
      payload.city || '',
      payload.date,
      event.id,
    );
    await supabase.from('events').update({ slug }).eq('id', event.id).eq('user_id', user.id);
  }

  let uploadResult: UploadEventPhotosResult = { uploaded: 0, skipped: [] };
  if (uploadedFiles.length > 0) {
    try {
      uploadResult = await uploadEventPhotos(supabase, user.id, event, uploadedFiles, payload);
    } catch (error) {
      console.error('createEvent: upload failed', error);
      await deleteEventPhotos(supabase, event.id, user.id);
      await deleteEvent(supabase, event.id, user.id);
      throw new Error(
        error instanceof Error ? error.message : 'Unable to upload photos. Please try again.',
      );
    }

    // Solo events require at least one photo. If every file was skipped due
    // to the storage cap, roll back the event row and surface the upgrade
    // prompt as a typed PlanLimitError.
    if (eventType === 'solo' && uploadResult.uploaded === 0 && uploadResult.skipped.length > 0) {
      await deleteEventPhotos(supabase, event.id, user.id);
      await deleteEvent(supabase, event.id, user.id);
      const plan = await getCurrentPlan(supabase, user.id);
      const currentUsage = await getStorageUsageBytes(supabase, user.id);
      throw new PlanLimitError({
        limitType: 'storage',
        current: currentUsage,
        max: (plan.storageGB ?? 0) * 1024 ** 3,
        planId: plan.id,
      });
    }
  }

  await revalidateAfterEventCreate(supabase, user.id, event.id);

  return {
    eventId: event.id,
    shareCode,
    uploaded: uploadResult.uploaded,
    skipped: uploadResult.skipped,
  };
};
