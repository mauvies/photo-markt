'use server';

import { Buffer } from 'node:buffer';
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { createEvent as dbCreateEvent } from '@/database/queries';
import { setEventCoverPath } from '@/database/queries/events';
import { createSignedUploadUrl, deleteStorageFiles } from '@/database/queries/storage';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import {
  type BundleTier,
  eventAcceptsBundleConfig,
  parseAllPhotosSubmission,
  parseBundleTiersSubmission,
  serializeBundleTiers,
  validateBundleSchedule,
} from '@/lib/bundle-pricing';
import { bundleScheduleErrorMessage } from '@/lib/bundle-schedule-error';
import { isValidSessionRange, normalizeSessionTime, SESSION_RANGE_ERROR } from '@/lib/format-date';
import { inngest } from '@/lib/inngest/client';
import { minPhotoPriceErrorMessage } from '@/lib/min-photo-price';
import { validatePhotoBuffer } from '@/lib/photo-upload';
import { assertCanCreateEvent } from '@/lib/plan-limits';
import { isPhotoPriceAboveFloor, MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';
import { generateEventSlug } from '@/lib/slugify';
import { resolveWatermarkEnabled } from '@/lib/watermark-policy';
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
    // Optional manual session end time — mirror of session_time (T-180). The
    // cross-field "end requires start / end > start" rule is enforced by the
    // superRefine below (after both are normalized).
    session_end_time: z
      .string()
      .optional()
      .transform((val) => normalizeSessionTime(val)),
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
    ai_matching_enabled: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    contains_minors: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    bib_detection_enabled: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    reveal_gate_enabled: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    // Volume-pricing ladder (T-203), carried as JSON in the form payload.
    // Uses the INPUT parser (shape only), not the strict read-path reader: the
    // strict one fails closed to "no ladder", which on a write would silently
    // discard what the photographer typed and report success. Shape-only parsing
    // lets `validateBundleSchedule` in the superRefine below name the actual
    // violation (ordering, floor, not-a-discount) so the form can explain it.
    bundle_tiers: z.string().optional().transform(parseBundleTiersSubmission),
    // "All photos" flat price in cents (T-203) — a ceiling, independent of the
    // rungs. An absent field means "no flat price".
    bundle_all_photos_cents: z.string().optional().transform(parseAllPhotosSubmission),
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
    // T-195: a priced event must clear the configured floor. `price_per_photo`
    // is in euros here (the DB column is numeric(10,2)); the floor is in cents.
    // Free events (null / 0) are exempt and a floor of 0 disables the rule.
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
    // T-203: a bundle ladder is only meaningful on a single-seller priced
    // event, and must pass the write-time rules. `eventSupportsBundles` is the
    // shared gate — organizer events (several possible sellers, no revenue
    // split to charge a discount against) and free events (nothing to discount)
    // may not carry one at all.
    // Mirror of the edit action: an ineligible event (free, or organizer) has its
    // ladder normalized away in the body via `eventSupportsBundles` rather than
    // rejected here, so pricing state can never block a save that isn't about
    // pricing. Only a ladder that contradicts a price actually being set is an
    // error the photographer can act on.
    //
    // T-212: an UNPARSEABLE submission is now its own state and is always
    // rejected. It used to collapse into the same `null` as "no ladder", so a
    // cleared amount box or a `1` typed into a threshold silently discarded the
    // whole ladder and reported success — the very failure the input/read parser
    // split was introduced to prevent.
    if (data.bundle_tiers.kind === 'invalid') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: bundleScheduleErrorMessage(data.bundle_tiers.error),
        path: ['bundle_tiers'],
      });
    }
    if (data.bundle_all_photos_cents.kind === 'invalid') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: bundleScheduleErrorMessage(data.bundle_all_photos_cents.error),
        path: ['bundle_all_photos_cents'],
      });
    }

    const submittedTiers = data.bundle_tiers.kind === 'tiers' ? data.bundle_tiers.tiers : null;
    const submittedCap =
      data.bundle_all_photos_cents.kind === 'cents' ? data.bundle_all_photos_cents.cents : null;

    if (
      priceCents !== null &&
      priceCents > 0 &&
      data.event_type !== 'organizer' &&
      (submittedTiers !== null || submittedCap !== null)
    ) {
      const result = validateBundleSchedule(
        submittedTiers ?? [],
        priceCents,
        minCents,
        submittedCap,
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

// --- Types ---

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
 * Create a new event row from the wizard form data. Bytes are NEVER
 * uploaded through this SA — the client follows up with
 * `createPhotoUploadUrls` → direct PUT to Storage → `attachPhotosToEvent`.
 *
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
    session_time: formData.get('session_time')?.toString(),
    session_end_time: formData.get('session_end_time')?.toString(),
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
    // Without these, the schema's `'false'` default sticks and AI matching
    // silently never persists — regression from the upload refactor.
    ai_matching_enabled: formData.get('ai_matching_enabled')?.toString() ?? 'false',
    contains_minors: formData.get('contains_minors')?.toString() ?? 'false',
    bib_detection_enabled: formData.get('bib_detection_enabled')?.toString() ?? 'false',
    reveal_gate_enabled: formData.get('reveal_gate_enabled')?.toString() ?? 'false',
    bundle_tiers: formData.get('bundle_tiers')?.toString(),
    bundle_all_photos_cents: formData.get('bundle_all_photos_cents')?.toString(),
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
  // share code — access is via the event_photographers join table. Minors
  // events are always private too (T-177 invariant: contains_minors ⇒ !is_public;
  // their privacy comes from the share code, not the reveal gate).
  const isPublic = eventType === 'organizer' || payload.contains_minors ? false : payload.is_public;

  // Public solo events use a SEO slug; everything else needs a share code
  // (collaborative) or has no public access at all (organizer).
  const shareCode =
    eventType === 'organizer' ? null : isPublic && !isCollaborative ? null : generateShareCode();
  // Shared with `updateEventAction` and both forms (T-211) — see
  // `watermark-policy.ts` for why this rule may only exist in one place.
  const watermarkEnabled = resolveWatermarkEnabled({
    eventType,
    isPublic,
    requested: payload.watermark_enabled,
  });

  const organizerFeeCents =
    eventType === 'organizer' ? dollarsToCents(payload.organizer_fee_per_photo) : null;

  // `contains_minors=true` forces AI matching and bib detection off regardless
  // of what the form sent — defense in depth in case the UI was bypassed.
  const aiMatchingEnabled = payload.contains_minors ? false : payload.ai_matching_enabled;
  const bibDetectionEnabled = payload.contains_minors ? false : payload.bib_detection_enabled;
  const containsMinors = payload.contains_minors;
  // Reveal gate (T-177): face search is its only key, so it's valid only when
  // AI matching is on. That also blocks it on minors events (which force AI off
  // above). Forced off otherwise — defense in depth if the UI is bypassed.
  const revealGateEnabled = aiMatchingEnabled ? payload.reveal_gate_enabled : false;

  // T-203: an organizer event stores no price (see `price_per_photo` below), so
  // it can carry no ladder either — re-derived here rather than trusted from the
  // payload, matching how `watermarkEnabled` / `revealGateEnabled` are forced.
  // Normalize rather than trust the payload: an organizer event stores no price
  // (see `price_per_photo` below) and a free event has nothing to discount, so
  // neither may carry a ladder. Same shape as the forced `watermarkEnabled` /
  // `revealGateEnabled` above — and it is what lets the schema stay silent about
  // ineligible events instead of failing a save.
  // T-212: `eventAcceptsBundleConfig`, NOT `eventSupportsBundles` — the latter
  // folds in `BUNDLE_PRICING_ENABLED`, so rolling the feature back would make
  // every create drop the ladder the photographer configured. The kill switch
  // must stop bundles being READ, never stop them being stored.
  const bundleEligible = eventAcceptsBundleConfig({
    type: eventType,
    price_per_photo: eventType === 'organizer' ? null : (payload.price_per_photo ?? null),
  });
  const bundleTiers: BundleTier[] | null =
    bundleEligible && payload.bundle_tiers.kind === 'tiers' ? payload.bundle_tiers.tiers : null;
  const bundleAllPhotosCents: number | null =
    bundleEligible && payload.bundle_all_photos_cents.kind === 'cents'
      ? payload.bundle_all_photos_cents.cents
      : null;

  const event = await dbCreateEvent(supabase, user.id, {
    name: payload.name,
    activity: payload.activity,
    date: payload.date,
    session_time: payload.session_time,
    session_end_time: payload.session_end_time,
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
    ai_matching_enabled: aiMatchingEnabled,
    contains_minors: containsMinors,
    bib_detection_enabled: bibDetectionEnabled,
    reveal_gate_enabled: revealGateEnabled,
    bundle_tiers: serializeBundleTiers(bundleTiers),
    bundle_all_photos_cents: bundleAllPhotosCents,
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

  // If AI matching is enabled at create time, kick the backfill worker so
  // the per-event collection is materialized — even before any photos exist.
  // Per-photo `photo.uploaded` events emit later from `attachPhotosToEvent`.
  if (aiMatchingEnabled && !containsMinors) {
    try {
      await inngest.send({
        name: 'event.ai-matching-enabled',
        data: { eventId: event.id, userId: user.id },
      });
    } catch (err) {
      console.error('[createEvent] failed to enqueue event.ai-matching-enabled', err);
    }
  }

  if (bibDetectionEnabled && !containsMinors) {
    try {
      await inngest.send({
        name: 'event.bib-detection-enabled',
        data: { eventId: event.id, userId: user.id },
      });
    } catch (err) {
      console.error('[createEvent] failed to enqueue event.bib-detection-enabled', err);
    }
  }

  await revalidateAfterEventCreate(supabase, user.id, event.id);

  return {
    eventId: event.id,
    shareCode,
  };
};

/**
 * Owner-only guard shared by the two halves of the cover upload. Resolves the
 * event row (and its current cover) or throws — the mint step and the attach step
 * must agree on who is allowed to touch which event, so neither re-derives it.
 */
const requireCoverOwner = async (
  eventId: string,
): Promise<{
  supabase: SupabaseClient;
  userId: string;
  previousCoverPath: string | null;
}> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  if (!eventId) throw new Error('Missing event id.');

  const { data: eventRow } = await supabase
    .from('events')
    .select('id, user_id, cover_path')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!eventRow || eventRow.user_id !== user.id) {
    throw new Error('Event not found or access denied.');
  }

  return {
    supabase,
    userId: user.id,
    previousCoverPath: (eventRow as { cover_path: string | null }).cover_path,
  };
};

/** Storage prefix every cover object of an event must live under. */
const coverPathPrefix = (userId: string, eventId: string): string => `${userId}/${eventId}/`;

/** Same defense-in-depth as the photo flow: the extension on the storage path is a
 *  hint only (the real format is settled from the bytes at attach time), so anything
 *  that isn't a short alphanumeric token becomes `jpg`. */
const COVER_EXTENSION_REGEX = /^[a-z0-9]{1,8}$/;
const sanitizeCoverExtension = (filename: string | undefined): string => {
  if (!filename) return 'jpg';
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'jpg';
  const ext = filename.slice(dot + 1).toLowerCase();
  return COVER_EXTENSION_REGEX.test(ext) ? ext : 'jpg';
};

/**
 * Step 1 of the cover upload (T-238): mint a single-use signed upload URL the
 * browser PUTs the cover bytes to **directly**, and return the storage path it
 * will land on. Owner-only.
 *
 * The bytes deliberately never enter this function. Vercel caps a serverless
 * request body at 4.5 MB and that cap cannot be configured away, so the previous
 * `FormData`-carrying action answered a normal-sized cover with an un-catchable
 * platform 413 (`FUNCTION_PAYLOAD_TOO_LARGE`) — the user saw Vercel's raw error
 * page instead of the app's toast. This is the same signed-URL pattern the photo
 * uploads have always used (`events/[id]/upload-urls/actions.ts`).
 *
 * The path — including its extension — is SERVER-generated; the client only
 * contributes a filename we take the extension hint from, sanitized the same way
 * the photo flow sanitizes it. The authoritative content type is settled later,
 * in {@link attachEventCoverAction}, from the stored bytes.
 */
export const createEventCoverUploadUrlAction = async (
  eventId: string,
  filename?: string,
): Promise<{ path: string; signedUrl: string }> => {
  const { userId } = await requireCoverOwner(eventId);

  const extension = sanitizeCoverExtension(filename);
  const path = `${coverPathPrefix(userId, eventId)}cover-${crypto.randomUUID()}.${extension}`;
  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const minted = await createSignedUploadUrl(adminClient, 'photos', path);
  return { path: minted.path, signedUrl: minted.signedUrl };
};

/**
 * Step 2 of the cover upload (T-238): adopt an object the browser just PUT as the
 * event's cover. Owner-only.
 *
 * ⚠️ **This is where the magic-byte validation moved to.** With the bytes no longer
 * passing through the action, `validatePhotoUpload` can't run *before* the write —
 * so the object is downloaded back from Storage and validated here, and **deleted
 * again if it isn't a real image**. Same shape as the photo path, where the Inngest
 * worker validates bytes post-upload and hard-deletes on a `rejected` verdict; a
 * renamed `.exe` still never survives in the bucket, it just gets thrown out a
 * moment later instead of a moment earlier.
 *
 * The path is checked against the caller's own `${userId}/${eventId}/` prefix, so a
 * forged path can neither adopt another photographer's object as a cover nor point
 * `cover_path` at something outside the event.
 *
 * The cover is a standalone presentation image — NOT a for-sale photo — so it is
 * served un-watermarked and has no `photos` row. Its lifecycle stays explicit: the
 * orphan-cleanup cron spares paths referenced by `events.cover_path` (and sweeps an
 * abandoned upload that never got attached), and event deletion removes the object.
 */
export const attachEventCoverAction = async (eventId: string, path: string): Promise<void> => {
  const { supabase, userId, previousCoverPath } = await requireCoverOwner(eventId);

  if (!path?.startsWith(coverPathPrefix(userId, eventId))) {
    throw new Error('Invalid cover path.');
  }

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const dropUploaded = async () => {
    try {
      await deleteStorageFiles(adminClient, 'photos', [path]);
    } catch (err) {
      console.error('[attachEventCoverAction] failed to remove rejected cover', err);
    }
  };

  // Read the bytes back and run the same magic-byte validation the direct
  // `FormData` upload used to run inline.
  const { data: blob, error: downloadError } = await supabaseAdmin.storage
    .from('photos')
    .download(path);
  if (downloadError || !blob) {
    throw new Error('Cover image could not be read back from storage.');
  }

  try {
    await validatePhotoBuffer(Buffer.from(await blob.arrayBuffer()));
  } catch (err) {
    await dropUploaded();
    throw err instanceof Error ? err : new Error('File is not a valid image.');
  }

  await setEventCoverPath(supabase, eventId, userId, path);

  // Best-effort removal of the previous cover object on replace — the row now
  // points at the new one regardless.
  if (previousCoverPath && previousCoverPath !== path) {
    try {
      await deleteStorageFiles(supabase, 'photos', [previousCoverPath]);
    } catch (err) {
      console.error('[attachEventCoverAction] failed to remove previous cover', err);
    }
  }

  await revalidateAfterEventCreate(supabase, userId, eventId);
};

/**
 * Remove an event's dedicated cover, reverting the card to the first-photo
 * fallback. Owner-only. Deletes the stored object best-effort.
 */
export const removeEventCoverAction = async (eventId: string): Promise<void> => {
  const { supabase, userId, previousCoverPath } = await requireCoverOwner(eventId);

  await setEventCoverPath(supabase, eventId, userId, null);

  if (previousCoverPath) {
    try {
      await deleteStorageFiles(supabase, 'photos', [previousCoverPath]);
    } catch (err) {
      console.error('[removeEventCoverAction] failed to remove cover', err);
    }
  }

  await revalidateAfterEventCreate(supabase, userId, eventId);
};
