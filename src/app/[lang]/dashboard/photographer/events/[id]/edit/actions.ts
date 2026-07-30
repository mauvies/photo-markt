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
  getSoldPhotoIds,
  isPhotoSold,
  softDeletePhotosByIds,
  updateEvent,
} from '@/database/queries';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import {
  eventSupportsBundles,
  parseAllPhotosCents,
  parseBundleTiersInput,
  serializeBundleTiers,
  validateBundleSchedule,
} from '@/lib/bundle-pricing';
import { bundleScheduleErrorMessage } from '@/lib/bundle-schedule-error';
import { isValidSessionRange, normalizeSessionTime, SESSION_RANGE_ERROR } from '@/lib/format-date';
import { inngest } from '@/lib/inngest/client';
import { minPhotoPriceErrorMessage } from '@/lib/min-photo-price';
import { isPhotoPriceAboveFloor, MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';

// --- Constants ---

const SHARE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

// --- Schema ---

const eventSchema = z
  .object({
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
    // Optional manual session time — normalized to "HH:mm" or null (T-106).
    session_time: z
      .string()
      .optional()
      .transform((val) => normalizeSessionTime(val)),
    // Optional manual session end time — mirror of session_time (T-180).
    session_end_time: z
      .string()
      .optional()
      .transform((val) => normalizeSessionTime(val)),
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
    reveal_gate_enabled: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    // Volume-pricing ladder (T-203) — mirror of the create action. An absent
    // field means "clear the ladder", which is what lets the scoped pricing
    // editor remove every rung.
    bundle_tiers: z
      .string()
      .optional()
      .transform((val) => (val && val.trim() !== '' ? parseBundleTiersInput(val) : null)),
    // "All photos" flat price in cents (T-203) — a ceiling, independent of the
    // rungs. An absent field means "no flat price".
    bundle_all_photos_cents: z
      .string()
      .optional()
      .transform((val) => (val && val.trim() !== '' ? parseAllPhotosCents(val) : null)),
  })
  .superRefine((data, ctx) => {
    // T-180: an end time requires a start and must be after it.
    if (!isValidSessionRange(data.session_time, data.session_end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SESSION_RANGE_ERROR,
        path: ['session_end_time'],
      });
    }
    // T-195: mirror of the create action's floor. Applied only when the price
    // is actually written, so an event priced below a later-raised floor keeps
    // working until someone edits it.
    const minCents = MIN_PHOTO_PRICE_CENTS;
    const priceCents =
      data.price_per_photo === null ? null : Math.round(data.price_per_photo * 100);
    if (!isPhotoPriceAboveFloor(priceCents, minCents)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: minPhotoPriceErrorMessage(minCents),
        path: ['price_per_photo'],
      });
    }
    // T-203: mirror of the create action's ladder rules. The event type is not
    // in this payload (it is immutable after creation), so the organizer
    // exclusion is enforced against the stored row in the action body below;
    // here we can still reject a ladder on an event being made free.
    //
    // A free event carries no bundle BY DEFINITION (`eventSupportsBundles`), so
    // "no price + a ladder" is normalized away in the action body rather than
    // rejected here. Rejecting it broke an unrelated edit: every section-scoped
    // form echoes the whole event, so editing *settings* on an event whose price
    // had been cleared threw `BUNDLE_TIERS:total_not_a_discount` and 500'd —
    // pricing state blocking a save that never touched pricing. The body already
    // forces the ladder off in exactly the way it forces `watermark_enabled` and
    // `reveal_gate_enabled` off when their preconditions fail.
    //
    // What IS worth an error is a ladder that contradicts a price the
    // photographer is actually setting — that is a real mistake with a fix.
    if (
      priceCents !== null &&
      priceCents > 0 &&
      (data.bundle_tiers !== null || data.bundle_all_photos_cents !== null)
    ) {
      const result = validateBundleSchedule(
        data.bundle_tiers ?? [],
        priceCents,
        minCents,
        data.bundle_all_photos_cents,
      );
      if (!result.ok && result.error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: bundleScheduleErrorMessage(result.error, result.minCents),
          path: ['bundle_tiers'],
        });
      }
    }
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
): Promise<{ success: true; retainedSoldCount: number }> {
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
    session_time: formData.get('session_time')?.toString(),
    session_end_time: formData.get('session_end_time')?.toString(),
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
    reveal_gate_enabled: formData.get('reveal_gate_enabled')?.toString() ?? 'false',
    bundle_tiers: formData.get('bundle_tiers')?.toString(),
    bundle_all_photos_cents: formData.get('bundle_all_photos_cents')?.toString(),
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
  // Minors invariant (T-177): a minors event can never be public — its privacy
  // comes from the private event + share code. `contains_minors` is immutable
  // above, so this only needs to block making an existing minors event public.
  const isPublic = currentContainsMinors ? false : payload.is_public;
  // Reveal gate (T-177): valid only with AI matching on (its only key), which
  // also excludes minors events. Forced off otherwise — defense in depth.
  const revealGateEnabled = aiMatchingEnabled ? payload.reveal_gate_enabled : false;
  const currentAiEnabled = Boolean(
    (currentEvent as unknown as Record<string, unknown>).ai_matching_enabled,
  );
  const currentBibEnabled = Boolean(
    (currentEvent as unknown as Record<string, unknown>).bib_detection_enabled,
  );

  // Collaborative events always need a share code (that's the entry point for
  // contributors). Public non-collaborative events don't.
  let shareCode: string | null = currentEvent.share_code;
  if (payload.is_collaborative || !isPublic) {
    if (!shareCode) shareCode = generateShareCode();
  } else {
    shareCode = null;
  }

  const watermarkEnabled = isPublic && payload.watermark_enabled;

  // T-203: the ladder's event-type gate can only be checked against the STORED
  // row — `type` is immutable after creation and is not in this payload. An
  // organizer event may never carry a ladder (several possible sellers, and no
  // revenue split to charge a discount against), so drop it rather than
  // erroring: the form never offers the field for those events, so a ladder
  // arriving here is a hand-crafted POST, not a user mistake worth explaining.
  const bundleTiers = eventSupportsBundles({
    type: currentEvent.type,
    price_per_photo: payload.price_per_photo ?? null,
  })
    ? payload.bundle_tiers
    : null;
  const bundleAllPhotosCents = eventSupportsBundles({
    type: currentEvent.type,
    price_per_photo: payload.price_per_photo ?? null,
  })
    ? payload.bundle_all_photos_cents
    : null;

  const updateData: Parameters<typeof updateEvent>[3] = {
    name: payload.name,
    activity: payload.activity,
    date: payload.date,
    country: payload.country,
    state: payload.state,
    city: payload.city || '',
    is_public: isPublic,
    share_code: shareCode,
    price_per_photo: payload.price_per_photo ?? null,
    watermark_enabled: watermarkEnabled,
    is_collaborative: payload.is_collaborative,
    allow_guest_upload: payload.allow_guest_upload,
    require_upload_approval: payload.require_upload_approval,
    ai_matching_enabled: aiMatchingEnabled,
    bib_detection_enabled: bibDetectionEnabled,
    reveal_gate_enabled: revealGateEnabled,
  };
  // Only write the migration-gated session_time column when it's actually in
  // play — a value is being set, or an existing one cleared. A plain edit
  // (rename, price change, …) on an event with no session time never touches
  // the column, so such edits still work if the migration hasn't reached the
  // target DB yet (createEvent guards the same way).
  if (payload.session_time !== null || currentEvent.session_time != null) {
    updateData.session_time = payload.session_time;
  }
  // Same migration-gating for the T-180 end time.
  if (
    payload.session_end_time !== null ||
    (currentEvent as { session_end_time?: string | null }).session_end_time != null
  ) {
    updateData.session_end_time = payload.session_end_time;
  }
  // Same migration-gating for the T-203 ladder: only touch the column when a
  // ladder is being set or an existing one cleared, so a plain edit still works
  // against a DB that hasn't applied the migration yet.
  if (bundleTiers !== null || currentEvent.bundle_tiers != null) {
    updateData.bundle_tiers = serializeBundleTiers(bundleTiers);
  }
  // Same migration-gating for the "all photos" ceiling.
  if (bundleAllPhotosCents !== null || currentEvent.bundle_all_photos_cents != null) {
    updateData.bundle_all_photos_cents = bundleAllPhotosCents;
  }

  await updateEvent(supabase, eventId, user.id, updateData);

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

  let retainedSoldCount = 0;
  if (photoIdsToDelete && photoIdsToDelete.length > 0) {
    // T-142: batch the sold-check once for the whole removal set (not 2 queries
    // per photo). Sold photos are retained for their buyers (soft-delete, keep
    // storage); the rest hard-delete + drop storage as before.
    const soldIds = await getSoldPhotoIds(supabaseAdmin, photoIdsToDelete);
    if (soldIds.size > 0) {
      await softDeletePhotosByIds(supabaseAdmin, [...soldIds]);
      retainedSoldCount = soldIds.size;
    }
    for (const photoId of photoIdsToDelete) {
      if (soldIds.has(photoId)) continue; // retained above
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

  // `retainedSoldCount` > 0 → the form should tell the photographer those sold
  // photos were kept for their buyers rather than destroyed (T-142).
  return { success: true, retainedSoldCount };
}

/**
 * Delete a single photo from an event.
 *
 * Returns `{ retained: true }` when the photo had been SOLD and was therefore
 * soft-deleted (kept for the buyer) instead of destroyed (T-142); `false` when
 * it was hard-deleted.
 */
export async function deletePhotoAction(
  photoId: string,
  eventId: string,
): Promise<{ retained: boolean }> {
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

  // T-142: a sold photo is retained for its buyer (soft-delete, keep the row +
  // storage) instead of hard-deleting, which would otherwise fail on the
  // ON DELETE RESTRICT FK. Unsold photos hard-delete + drop storage as before.
  let retained = false;
  if (await isPhotoSold(supabaseAdmin, photoId)) {
    await softDeletePhotosByIds(supabaseAdmin, [photoId]);
    retained = true;
  } else {
    await dbDeletePhoto(supabase, photoId, user.id);
    if (photo.original_url) {
      await deleteStorageFiles(supabase, 'photos', [photo.original_url]);
    }
  }

  const event = await getEvent(supabase, eventId, user.id);
  await revalidateAfterEventMutation(supabase, user.id, {
    id: eventId,
    slug: event?.slug ?? null,
    share_code: event?.share_code ?? null,
  });

  return { retained };
}
