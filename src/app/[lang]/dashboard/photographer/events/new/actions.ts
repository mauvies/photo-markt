'use server';

import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { z } from 'zod';
import { createEvent as dbCreateEvent } from '@/database/queries';
import { setEventCoverPath } from '@/database/queries/events';
import { deleteStorageFiles, uploadFile } from '@/database/queries/storage';
import type { SupabaseServerClient } from '@/database/queries/types';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { isValidSessionRange, normalizeSessionTime, SESSION_RANGE_ERROR } from '@/lib/format-date';
import { inngest } from '@/lib/inngest/client';
import { minPhotoPriceErrorMessage } from '@/lib/min-photo-price';
import { validatePhotoUpload } from '@/lib/photo-upload';
import { assertCanCreateEvent } from '@/lib/plan-limits';
import { isPhotoPriceAboveFloor, MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';
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
  const watermarkEnabled =
    eventType === 'organizer' ? payload.watermark_enabled : isPublic && payload.watermark_enabled;

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
 * Upload (or replace) an event's dedicated cover/presentation image. Owner-only.
 *
 * The image is validated (magic bytes, 50 MB cap) and stored in the private
 * `photos` bucket under the event folder. It is a standalone presentation
 * image — NOT one of the for-sale photos — so it is served un-watermarked and
 * has no `photos` row. Because of that, its lifecycle is handled explicitly:
 * the orphan-cleanup cron skips paths referenced by `events.cover_path`, and
 * event deletion removes the object.
 */
export const uploadEventCoverAction = async (
  eventId: string,
  formData: FormData,
): Promise<void> => {
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

  const file = formData.get('cover');
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('No cover image provided.');
  }

  // Never trust the client MIME/extension — derive from magic bytes.
  const { buffer, contentType, extension } = await validatePhotoUpload(file);
  const path = `${user.id}/${eventId}/cover-${crypto.randomUUID()}.${extension}`;
  // Use the admin client for the upload: the `photos` bucket has no user-level
  // INSERT policy that covers direct uploads (only signed-URL uploads bypass
  // RLS via the token). Ownership + file validation are already enforced above.
  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  await uploadFile(adminClient, 'photos', path, buffer, { contentType, upsert: false });

  await setEventCoverPath(supabase, eventId, user.id, path);

  // Best-effort removal of the previous cover object on replace — the row now
  // points at the new one regardless.
  const previous = (eventRow as { cover_path: string | null }).cover_path;
  if (previous && previous !== path) {
    try {
      await deleteStorageFiles(supabase, 'photos', [previous]);
    } catch (err) {
      console.error('[uploadEventCoverAction] failed to remove previous cover', err);
    }
  }

  await revalidateAfterEventCreate(supabase, user.id, eventId);
};

/**
 * Remove an event's dedicated cover, reverting the card to the first-photo
 * fallback. Owner-only. Deletes the stored object best-effort.
 */
export const removeEventCoverAction = async (eventId: string): Promise<void> => {
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

  await setEventCoverPath(supabase, eventId, user.id, null);

  const previous = (eventRow as { cover_path: string | null }).cover_path;
  if (previous) {
    try {
      await deleteStorageFiles(supabase, 'photos', [previous]);
    } catch (err) {
      console.error('[removeEventCoverAction] failed to remove cover', err);
    }
  }

  await revalidateAfterEventCreate(supabase, user.id, eventId);
};
