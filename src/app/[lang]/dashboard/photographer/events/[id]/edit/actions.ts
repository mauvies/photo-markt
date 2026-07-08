'use server';

import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { activityValues } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import {
  deletePhoto as dbDeletePhoto,
  deleteStorageFiles,
  eventExists,
  getEvent,
  getPhoto,
  updateEvent,
} from '@/database/queries';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { inngest } from '@/lib/inngest/client';

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
  ai_matching_enabled: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  bib_detection_enabled: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  // Sent by the form for the immutability check below. Any change vs. the
  // current DB value is rejected — defense in depth.
  contains_minors: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
});

// --- Helpers ---

function generateShareCode(): string {
  return Array.from({ length: SHARE_CODE_LENGTH }, () =>
    SHARE_CODE_CHARSET.charAt(Math.floor(Math.random() * SHARE_CODE_CHARSET.length)),
  ).join('');
}

async function revalidateAfterEventMutation(
  supabase: SupabaseServerClient,
  userId: string,
  event: { id: string; slug: string | null; share_code: string | null },
): Promise<void> {
  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/es/dashboard/photographer/events/${event.id}/edit`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}/edit`);
  revalidateTag('events-public', 'max');
  revalidateTag('top-events', 'max');
  // The talent and public event routes cache by whichever param the visitor
  // used — UUID, slug, or share_code — so invalidate all three variants.
  revalidateTag(`event-${event.id}`, 'max');
  if (event.slug) revalidateTag(`event-${event.slug}`, 'max');
  if (event.share_code) revalidateTag(`event-${event.share_code}`, 'max');
  revalidateTag(`photographer-events-${userId}`, 'max');
  revalidateTag(`dashboard-photographer-${userId}`, 'max');
  updateTag(`event-${event.id}`);
  updateTag(`photographer-events-${userId}`);

  // The photographer's public profile (`/photographer/[slug]`) lists this
  // event's card too — without this tag an edited/deleted event keeps
  // showing there until the tag's natural TTL (create already does this).
  const { data: profile } = await supabase
    .from('profiles')
    .select('slug')
    .eq('id', userId)
    .maybeSingle();
  if (profile?.slug) revalidateTag(`photographer-${profile.slug}`, 'max');
}

// --- Exports ---

/**
 * Update event metadata. Photo uploads happen separately via the
 * direct-to-Storage flow (`createPhotoUploadUrls` → PUT → `attachPhotosToEvent`).
 */
export async function updateEventAction(
  eventId: string,
  formData: FormData,
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
    ai_matching_enabled: formData.get('ai_matching_enabled')?.toString() ?? 'false',
    bib_detection_enabled: formData.get('bib_detection_enabled')?.toString() ?? 'false',
    contains_minors: formData.get('contains_minors')?.toString() ?? 'false',
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid event data provided.');
  }

  const payload = parsed.data;

  const currentEvent = await getEvent(supabase, eventId, user.id);
  if (!currentEvent) throw new Error('Event not found.');

  // `contains_minors` is immutable post-creation — reject any change vs the
  // stored value. Defense in depth: the form input is disabled, but a
  // hand-crafted POST shouldn't be able to flip the flag either.
  const currentContainsMinors = Boolean(
    (currentEvent as unknown as Record<string, unknown>).contains_minors,
  );
  if (payload.contains_minors !== currentContainsMinors) {
    throw new Error('This setting cannot be changed after event creation.');
  }
  // And: if the event contains minors, AI matching and bib detection cannot be enabled.
  const aiMatchingEnabled = currentContainsMinors ? false : payload.ai_matching_enabled;
  const bibDetectionEnabled = currentContainsMinors ? false : payload.bib_detection_enabled;
  const currentAiEnabled = Boolean(
    (currentEvent as unknown as Record<string, unknown>).ai_matching_enabled,
  );
  const currentBibEnabled = Boolean(
    (currentEvent as unknown as Record<string, unknown>).bib_detection_enabled,
  );

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
    ai_matching_enabled: aiMatchingEnabled,
    bib_detection_enabled: bibDetectionEnabled,
  });

  // AI matching state transitions — kick the Inngest worker on change.
  // Same payloads the dedicated server actions emit.
  if (aiMatchingEnabled && !currentAiEnabled) {
    try {
      await inngest.send({
        name: 'event.ai-matching-enabled',
        data: { eventId, userId: user.id },
      });
    } catch (err) {
      console.error('[updateEventAction] failed to enqueue ai-matching-enabled', err);
    }
  } else if (!aiMatchingEnabled && currentAiEnabled) {
    try {
      await inngest.send({
        name: 'event.ai-matching-disabled',
        data: { eventId },
      });
    } catch (err) {
      console.error('[updateEventAction] failed to enqueue ai-matching-disabled', err);
    }
  }

  // Bib detection transitions — only fire Inngest when enabling (backfill).
  // Disabling only updates the DB column (no cleanup needed per spec).
  if (bibDetectionEnabled && !currentBibEnabled) {
    try {
      await inngest.send({
        name: 'event.bib-detection-enabled',
        data: { eventId, userId: user.id },
      });
    } catch (err) {
      console.error('[updateEventAction] failed to enqueue bib-detection-enabled', err);
    }
  }

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

  await revalidateAfterEventMutation(supabase, user.id, {
    id: eventId,
    slug: currentEvent.slug,
    share_code: shareCode,
  });
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

  const event = await getEvent(supabase, eventId, user.id);
  await revalidateAfterEventMutation(supabase, user.id, {
    id: eventId,
    slug: event?.slug ?? null,
    share_code: event?.share_code ?? null,
  });
}
