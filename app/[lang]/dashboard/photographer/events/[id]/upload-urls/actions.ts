'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import {
  countEventPhotos,
  createPhoto,
  deleteStorageFiles,
  getEventByShareCode,
  isApprovedEventPhotographer,
  type SupabaseServerClient,
  uploadGuestPhoto,
} from '@/database/queries';
import { getStorageUsageBytes } from '@/database/queries/photos';
import { updatePhotoFaceIndexStatus } from '@/database/queries/rekognition';
import { createSignedUploadUrls } from '@/database/queries/storage';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { isCollaborativeUploadOpen } from '@/lib/event-status';
import { inngest } from '@/lib/inngest/client';
import { assertCanUploadPhoto, isPlanLimitError } from '@/lib/plan-limits';
import { MAX_PHOTOS_PER_EVENT } from '@/lib/plans';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/** Hard cap on files per single SA call. Keeps the request body small and
 *  bounds Storage list operations downstream. The wizard chunks larger
 *  batches into multiple createPhotoUploadUrls calls. */
const MAX_FILES_PER_REQUEST = 100;
/** Guest-upload rate limit window — matches the legacy `uploadGuestPhotosAction`. */
const GUEST_RATELIMIT_WINDOW_SEC = 3600;
const GUEST_RATELIMIT_MAX = 30;
const MAX_GUEST_NAME_LENGTH = 60;
const MAX_GUEST_EMAIL_LENGTH = 120;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Allowed extensions on the storage path component. Worker still derives
 *  the canonical extension from magic bytes; this filter is just a
 *  defense-in-depth against weird path payloads. */
const EXTENSION_REGEX = /^[a-z0-9]{1,8}$/;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UploadFileMetadata {
  originalFilename: string;
  sizeBytes: number;
  /** Client-supplied MIME. Stored only for diagnostics — never trusted. */
  mimeType: string;
}

export interface CreateUploadUrlsInput {
  eventId: string;
  files: UploadFileMetadata[];
  /** Required for guest uploads on collaborative events; the SA verifies
   *  it matches `events.share_code`. Authenticated owner/contributor flows
   *  pass `null`. */
  shareCode?: string | null;
  /** Guest-only display name. Ignored when the caller is authenticated. */
  guestName?: string | null;
  guestEmail?: string | null;
}

export interface CreateUploadUrlsResult {
  uploads: Array<{
    path: string;
    signedUrl: string;
    originalFilename: string;
  }>;
}

export interface AttachPhotosInput {
  eventId: string;
  shareCode?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  photos: Array<{
    path: string;
    originalFilename: string;
    sizeBytes: number;
  }>;
}

export interface AttachPhotosResult {
  inserted: Array<{
    id: string;
    path: string;
    /** Only populated for guest-flow photos — null otherwise. */
    deleteToken: string | null;
  }>;
  skipped: Array<{ path: string; reason: string }>;
}

export interface DiscardOrphansInput {
  eventId: string;
  shareCode?: string | null;
  paths: string[];
}

export interface DiscardOrphansResult {
  deleted: number;
  skipped: Array<{ path: string; reason: string }>;
}

// ─── Flow resolution ─────────────────────────────────────────────────────────

type UploadFlow =
  | {
      kind: 'owner';
      eventOwnerId: string;
      storageOwnerId: string;
      photoUserId: string;
      uploadedBy: string | null;
      requireApprovalAfterValidation: boolean;
      isGuestFlow: false;
      eventDate: string;
      city: string;
      country: string;
      state: string | null;
    }
  | {
      kind: 'organizer-contributor';
      eventOwnerId: string;
      storageOwnerId: string;
      photoUserId: string;
      uploadedBy: string | null;
      requireApprovalAfterValidation: boolean;
      isGuestFlow: false;
      eventDate: string;
      city: string;
      country: string;
      state: string | null;
    }
  | {
      kind: 'guest-collaborative';
      eventOwnerId: string;
      storageOwnerId: string;
      photoUserId: string;
      uploadedBy: string | null;
      requireApprovalAfterValidation: boolean;
      isGuestFlow: true;
      eventDate: string;
      city: string;
      country: string;
      state: string | null;
    };

interface EventRow {
  id: string;
  user_id: string;
  type: 'solo' | 'collaborative' | 'organizer';
  is_collaborative: boolean;
  allow_guest_upload: boolean;
  require_upload_approval: boolean;
  share_code: string | null;
  slug: string | null;
  date: string;
  city: string;
  country: string;
  state: string | null;
}

async function loadEvent(eventId: string): Promise<EventRow | null> {
  const { data, error } = await adminClient
    .from('events')
    .select(
      'id, user_id, type, is_collaborative, allow_guest_upload, require_upload_approval, share_code, slug, date, city, country, state, deleted_at',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data || data.deleted_at) return null;
  return data as EventRow;
}

/**
 * Resolve which of the four upload flows the caller belongs to, throwing
 * if none match. Centralizes the auth + flow-detection logic so the three
 * SAs (mint URLs / attach rows / discard orphans) can't drift on the rules
 * they enforce — they all branch on the same `UploadFlow`.
 */
async function resolveFlow(args: {
  event: EventRow;
  shareCode: string | null | undefined;
  guestName: string | null | undefined;
  guestEmail: string | null | undefined;
}): Promise<UploadFlow> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const baseContext = {
    eventOwnerId: args.event.user_id,
    eventDate: args.event.date,
    city: args.event.city ?? '',
    country: args.event.country ?? '',
    state: args.event.state,
  } as const;

  // Owner flow — caller authenticated as event owner.
  if (user && user.id === args.event.user_id) {
    return {
      kind: 'owner',
      ...baseContext,
      storageOwnerId: user.id,
      photoUserId: user.id,
      uploadedBy: user.id,
      // Owner uploads bypass approval queue entirely — the worker promotes
      // to 'approved' directly once validation passes.
      requireApprovalAfterValidation: false,
      isGuestFlow: false,
    };
  }

  // Organizer-contributor flow — authenticated, accepted on an organizer event.
  if (user && args.event.type === 'organizer') {
    const isAccepted = await isApprovedEventPhotographer(adminClient, {
      eventId: args.event.id,
      photographerId: user.id,
    });
    if (isAccepted) {
      return {
        kind: 'organizer-contributor',
        ...baseContext,
        // photos.user_id = contributor preserves attribution and any future
        // revenue routing. Storage cap is charged to the contributor (not
        // the event owner), matching the legacy `uploadOrganizerEventPhotoAction`
        // behavior — a v0 simplification; a follow-up may move accounting
        // to the organizer.
        storageOwnerId: user.id,
        photoUserId: user.id,
        uploadedBy: user.id,
        requireApprovalAfterValidation: args.event.require_upload_approval,
        isGuestFlow: false,
      };
    }
  }

  // Guest-collaborative flow — share_code-gated, may be authed or anon.
  if (
    args.shareCode &&
    args.event.is_collaborative &&
    args.event.allow_guest_upload &&
    args.event.share_code === args.shareCode &&
    isCollaborativeUploadOpen(args.event.date)
  ) {
    return {
      kind: 'guest-collaborative',
      ...baseContext,
      storageOwnerId: args.event.user_id,
      photoUserId: args.event.user_id,
      uploadedBy: user?.id ?? null,
      requireApprovalAfterValidation: args.event.require_upload_approval,
      isGuestFlow: true,
    };
  }

  throw new Error('Not authorized to upload photos for this event.');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'jpg';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_REGEX.test(ext) ? ext : 'jpg';
}

function buildPhotoPath(storageOwnerId: string, eventId: string, extension: string): string {
  return `${storageOwnerId}/${eventId}/${crypto.randomUUID()}.${extension}`;
}

function validatePathBelongsToFlow(path: string, flow: UploadFlow, eventId: string): boolean {
  return path.startsWith(`${flow.storageOwnerId}/${eventId}/`);
}

function trimGuestName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_GUEST_NAME_LENGTH) : null;
}

function validateGuestEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!EMAIL_REGEX.test(trimmed) || trimmed.length > MAX_GUEST_EMAIL_LENGTH) {
    throw new Error('Please enter a valid email address.');
  }
  return trimmed;
}

async function applyGuestRateLimit(eventId: string): Promise<void> {
  const ip = getClientIp(await headers());
  const rl = await rateLimit({
    key: `guest-upload-urls:${eventId}:${ip}`,
    limit: GUEST_RATELIMIT_MAX,
    windowSec: GUEST_RATELIMIT_WINDOW_SEC,
  });
  if (!rl.ok) {
    throw new Error('Too many uploads from this network. Please try again later.');
  }
}

function revalidateAfterUpload(eventId: string, event: EventRow): void {
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  if (event.share_code) {
    revalidatePath(`/es/events/${event.share_code}`);
    revalidatePath(`/en/events/${event.share_code}`);
    revalidateTag(`event-${event.share_code}`, 'max');
  }
  revalidateTag(`event-${eventId}`, 'max');
  if (event.slug) revalidateTag(`event-${event.slug}`, 'max');
}

// ─── createPhotoUploadUrls ───────────────────────────────────────────────────

/**
 * Mint signed upload URLs the client PUTs photo bytes to directly.
 *
 * Flow:
 *   1. Resolve event + caller's flow (owner / organizer-contrib / guest).
 *   2. For guest flow, apply the existing IP-keyed rate-limit.
 *   3. Plan-limit checks: storage cap on the storageOwner; per-event 5000 cap.
 *   4. Mint URLs via service-role; paths are server-generated as
 *      `${storageOwnerId}/${eventId}/${uuid}.${sanitizedExt}`.
 *
 * Returns a list aligned 1:1 with the input `files`. The client uploads
 * bytes to `signedUrl`, then calls `attachPhotosToEvent` with the paths.
 */
export async function createPhotoUploadUrls(
  input: CreateUploadUrlsInput,
): Promise<CreateUploadUrlsResult> {
  const { eventId, files, shareCode, guestName, guestEmail } = input;
  if (!eventId) throw new Error('Missing event id.');
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files provided.');
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw new Error(`Too many photos. Upload at most ${MAX_FILES_PER_REQUEST} at a time.`);
  }

  const event = await loadEvent(eventId);
  if (!event) throw new Error('Event not found.');

  const flow = await resolveFlow({
    event,
    shareCode: shareCode ?? null,
    guestName: guestName ?? null,
    guestEmail: guestEmail ?? null,
  });

  if (flow.isGuestFlow) {
    await applyGuestRateLimit(eventId);
    // Owner of the guest upload modal supplies a name (required) and
    // optional email — caught here so the URL-mint endpoint fails fast
    // rather than `attachPhotosToEvent` failing after a successful PUT.
    const supabase = await createClient();
    const {
      data: { user: authedUser },
    } = await supabase.auth.getUser();
    if (!authedUser) {
      if (!trimGuestName(guestName)) {
        throw new Error('Please enter your name before uploading.');
      }
      validateGuestEmail(guestEmail);
    }
  }

  // Plan-limit checks — storage cap then per-event 5000-photo cap. We use
  // the declared sizes to pre-flight; the worker later compares actual
  // bytes against `size_bytes` with a 1 KB margin so size-lying gets
  // caught even if the pre-check passed.
  const totalDeclaredBytes = files.reduce(
    (acc, f) => acc + (typeof f.sizeBytes === 'number' ? f.sizeBytes : 0),
    0,
  );
  const currentUsage = await getStorageUsageBytes(adminClient, flow.storageOwnerId);
  try {
    await assertCanUploadPhoto(adminClient, flow.storageOwnerId, totalDeclaredBytes, currentUsage);
  } catch (err) {
    if (isPlanLimitError(err)) throw err;
    throw err;
  }

  const existingCount = await countEventPhotos(adminClient, eventId);
  if (existingCount + files.length > MAX_PHOTOS_PER_EVENT) {
    throw new Error(
      `This event would exceed the ${MAX_PHOTOS_PER_EVENT}-photo limit (currently ${existingCount}).`,
    );
  }

  // Mint URLs in one round-trip.
  const paths = files.map((f) =>
    buildPhotoPath(flow.storageOwnerId, eventId, sanitizeExtension(f.originalFilename)),
  );
  const minted = await createSignedUploadUrls(adminClient, 'photos', paths);

  return {
    uploads: minted.map((m, i) => ({
      path: m.path,
      signedUrl: m.signedUrl,
      originalFilename: files[i].originalFilename,
    })),
  };
}

// ─── attachPhotosToEvent ─────────────────────────────────────────────────────

/**
 * Insert `photos` rows for paths the client just PUT to Storage, then emit
 * `photo.uploaded` so the Inngest worker validates the bytes (and indexes
 * faces when AI matching is enabled). Photos start at `upload_status='pending'`
 * — the worker promotes to `approved` or `rejected`.
 *
 * Per-path safety:
 *   - Path must start with `${flow.storageOwnerId}/${eventId}/`. Mismatches
 *     are skipped silently (server-side log preserves the audit trail).
 *
 * Returns per-photo insert + skip results. Inngest emit failure is logged
 * but doesn't fail the attach — a future Re-validate can pick up stuck
 * pending rows.
 */
export async function attachPhotosToEvent(input: AttachPhotosInput): Promise<AttachPhotosResult> {
  const { eventId, photos, shareCode, guestName, guestEmail } = input;
  if (!eventId) throw new Error('Missing event id.');
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new Error('No photos provided.');
  }
  if (photos.length > MAX_FILES_PER_REQUEST) {
    throw new Error(`Too many photos. Attach at most ${MAX_FILES_PER_REQUEST} at a time.`);
  }

  const event = await loadEvent(eventId);
  if (!event) throw new Error('Event not found.');

  const flow = await resolveFlow({
    event,
    shareCode: shareCode ?? null,
    guestName: guestName ?? null,
    guestEmail: guestEmail ?? null,
  });

  const trimmedGuestName = flow.isGuestFlow ? trimGuestName(guestName) : null;
  const validatedGuestEmail = flow.isGuestFlow ? validateGuestEmail(guestEmail) : null;

  const inserted: AttachPhotosResult['inserted'] = [];
  const skipped: AttachPhotosResult['skipped'] = [];

  for (const photo of photos) {
    if (!validatePathBelongsToFlow(photo.path, flow, eventId)) {
      console.warn('[attachPhotosToEvent] rejected path not belonging to flow', {
        eventId,
        path: photo.path,
        flow: flow.kind,
      });
      skipped.push({ path: photo.path, reason: 'path_mismatch' });
      continue;
    }
    if (typeof photo.sizeBytes !== 'number' || photo.sizeBytes <= 0) {
      skipped.push({ path: photo.path, reason: 'invalid_size' });
      continue;
    }

    try {
      let insertedId: string;
      let deleteToken: string | null = null;

      if (flow.isGuestFlow) {
        // Guest path uses uploadGuestPhoto so `uploaded_by` / `delete_token`
        // get persisted. The user_id is the event owner.
        const tokenForDelete = crypto.randomUUID();
        const row = await uploadGuestPhoto(adminClient, {
          event_id: eventId,
          owner_user_id: flow.eventOwnerId,
          uploaded_by: flow.uploadedBy,
          guest_name: trimmedGuestName,
          guest_email: validatedGuestEmail,
          original_url: photo.path,
          // Worker promotes after validation. Owner approval (if required)
          // keeps it in `pending` after the worker step.
          upload_status: 'pending',
          delete_token: tokenForDelete,
          taken_at: new Date().toISOString(),
          size_bytes: photo.sizeBytes,
        });
        insertedId = row.id;
        deleteToken = row.delete_token;
      } else {
        const row = await createPhoto(adminClient, flow.photoUserId, {
          event_id: eventId,
          original_url: photo.path,
          taken_at: new Date(flow.eventDate).toISOString(),
          city: flow.city,
          country: flow.country,
          state: flow.state,
          size_bytes: photo.sizeBytes,
          upload_status: 'pending',
          original_filename: photo.originalFilename,
        });
        insertedId = row.id;
      }

      inserted.push({ id: insertedId, path: photo.path, deleteToken });

      // Worker validates bytes and (when AI matching is enabled) indexes
      // faces. We emit unconditionally — the worker handles AI-off events
      // by setting face_index_status='not_applicable' and still running
      // validation.
      try {
        await inngest.send({
          name: 'photo.uploaded',
          data: { photoId: insertedId, eventId, storagePath: photo.path },
        });
      } catch (err) {
        console.error('[attachPhotosToEvent] failed to enqueue photo.uploaded', err);
        // Best-effort mark not_applicable so the row doesn't sit at
        // face_index_status='pending' forever if Inngest is unreachable.
        // The validate step still won't run — Re-validate will pick it up.
        try {
          await updatePhotoFaceIndexStatus(adminClient, insertedId, 'not_applicable');
        } catch {
          // best-effort cleanup; ignore
        }
      }
    } catch (err) {
      console.error('[attachPhotosToEvent] insert failed', { path: photo.path, err });
      skipped.push({ path: photo.path, reason: 'insert_failed' });
    }
  }

  // Stash the require-approval bit on a no-op so the import is "used" by
  // TS — the worker reads `require_upload_approval` off the event row at
  // validate time. Keep the SA boundary simple: just create rows.
  void flow.requireApprovalAfterValidation;

  revalidateAfterUpload(eventId, event);

  return { inserted, skipped };
}

// ─── discardOrphanedUploads ──────────────────────────────────────────────────

/**
 * Best-effort cleanup of files the client PUT but never attached — e.g.
 * the user clicked Cancel mid-upload. Skips paths that have since been
 * attached (would mean a race between client-Cancel and a parallel
 * attach), and silently skips anything not belonging to the caller's flow.
 *
 * Failures are not fatal: the Inngest orphan-cleanup cron sweeps every
 * 30 minutes regardless. This SA is just a UX nicety for Cancel.
 */
export async function discardOrphanedUploads(
  input: DiscardOrphansInput,
): Promise<DiscardOrphansResult> {
  const { eventId, paths, shareCode } = input;
  if (!eventId) throw new Error('Missing event id.');
  if (!Array.isArray(paths) || paths.length === 0) {
    return { deleted: 0, skipped: [] };
  }
  if (paths.length > MAX_FILES_PER_REQUEST) {
    throw new Error(`Too many paths. Discard at most ${MAX_FILES_PER_REQUEST} at a time.`);
  }

  const event = await loadEvent(eventId);
  if (!event) throw new Error('Event not found.');

  const flow = await resolveFlow({
    event,
    shareCode: shareCode ?? null,
    guestName: null,
    guestEmail: null,
  });

  const skipped: DiscardOrphansResult['skipped'] = [];
  const candidatePaths = paths.filter((p) => {
    if (!validatePathBelongsToFlow(p, flow, eventId)) {
      skipped.push({ path: p, reason: 'path_mismatch' });
      return false;
    }
    return true;
  });

  if (candidatePaths.length === 0) {
    return { deleted: 0, skipped };
  }

  // Defensive: don't delete paths that already have a photos row — that
  // would mean a parallel attachPhotosToEvent landed before the Cancel
  // reached us. The Inngest cron does the same cross-reference.
  const { data: attachedRows } = await adminClient
    .from('photos')
    .select('original_url')
    .in('original_url', candidatePaths)
    .eq('event_id', eventId);
  const attached = new Set(
    (attachedRows ?? [])
      .map((r) => r.original_url as string | null)
      .filter((p): p is string => typeof p === 'string'),
  );

  const toDelete: string[] = [];
  for (const p of candidatePaths) {
    if (attached.has(p)) {
      skipped.push({ path: p, reason: 'already_attached' });
      continue;
    }
    toDelete.push(p);
  }

  if (toDelete.length === 0) {
    return { deleted: 0, skipped };
  }

  try {
    await deleteStorageFiles(adminClient, 'photos', toDelete);
  } catch (err) {
    console.error('[discardOrphanedUploads] storage remove failed', err);
    // Caller never sees the failure — the cron will catch the orphans.
    return { deleted: 0, skipped };
  }

  return { deleted: toDelete.length, skipped };
}

// ─── Helper re-exports for SA-adjacent code paths ────────────────────────────

/**
 * Look up `share_code` → event when only the share code is in hand. Mirrors
 * the legacy guest-upload action and lets callers skip a dynamic import.
 */
export async function getEventByShareCodeAction(
  shareCode: string,
): Promise<{ id: string; user_id: string; share_code: string | null; slug: string | null } | null> {
  const event = await getEventByShareCode(adminClient, shareCode);
  if (!event) return null;
  return {
    id: event.id,
    user_id: event.user_id,
    share_code: event.share_code,
    slug: event.slug,
  };
}
