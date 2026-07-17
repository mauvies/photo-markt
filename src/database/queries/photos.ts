/**
 * Photo-related database queries
 */

// Import the sharp-free URL helper module — NOT '@/lib/thumbnails', which
// loads sharp at module scope: this query file is client-reachable via
// plan-limits.ts → the event wizard, and sharp breaks the browser build.
import { needsProtectedPreview } from '@/lib/preview-protection';
import { resolvePhotoPreviewUrl } from '@/lib/thumbnail-urls';
import { createPhotoUrlMap } from './storage';
import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type UploadStatus = 'approved' | 'pending' | 'rejected';
export type ThumbnailStatus = 'pending' | 'ready' | 'failed';

export interface Photo {
  id: string;
  user_id: string;
  event_id: string | null;
  original_url: string | null;
  taken_at: string | null;
  city?: string | null;
  country?: string | null;
  state?: string | null;
  uploaded_by?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  upload_status?: UploadStatus;
  size_bytes?: number | null;
  original_filename?: string | null;
  created_at?: string;
  thumbnail_status?: ThumbnailStatus;
}

export interface PhotoSummary {
  event_id: string | null;
  original_url: string | null;
  taken_at: string | null;
  upload_status?: UploadStatus;
  thumbnail_status?: ThumbnailStatus;
  /** Cache-bust token for the /api/thumb URL — bumped on every bake (T-078). */
  thumb_version?: number | null;
}

export interface PhotoDetail {
  id: string;
  original_url: string | null;
  taken_at: string | null;
  city: string | null;
  country: string | null;
  state: string | null;
  /** The row owner — set for every photo regardless of upload path. */
  user_id?: string | null;
  /** Set only for guest-uploaded photos; null for authenticated uploads. */
  uploaded_by?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  upload_status?: UploadStatus;
  /** Displayed pixel dimensions — `null` for legacy rows uploaded before
   * dimensions were captured. Drives the gallery's reserved-space layout. */
  width: number | null;
  height: number | null;
  thumbnail_status?: ThumbnailStatus;
  /** Cache-bust token for the /api/thumb URL — bumped on every bake (T-078). */
  thumb_version?: number | null;
}

/**
 * Filters that `getEventPhotos` accepts. The legacy callers pass a single
 * `status: UploadStatus` and an optional `skipUserIdFilter`. The new
 * direct-upload flow needs to render the owner's own *pending* photos
 * (the "Validating" badge) alongside approved ones — `includePending: true`
 * widens the filter to `approved + pending` for owner views.
 */
export interface GetEventPhotosOptions {
  status?: UploadStatus;
  skipUserIdFilter?: boolean;
  /** Owner view: include freshly-uploaded photos still being validated. */
  includePending?: boolean;
  /**
   * Exclude the event owner's own uploads (`user_id === userId AND
   * guest_name IS NULL`) — the same owner-vs-guest discrimination the face
   * indexer uses for auto-approve. The moderation queue must only surface
   * contributor/guest uploads: owner uploads auto-approve and must never appear
   * there, whatever the worker's transient state (T-109). The owner id is the
   * `userId` argument, so this composes with `skipUserIdFilter: true`.
   */
  excludeOwnerUploads?: boolean;
}

/** Pagination window for the `*Page` variants. */
export interface EventPhotoPageOptions {
  limit: number;
  offset: number;
}

/**
 * Deterministic gallery order shared by every paginated event-photo query so
 * successive pages never overlap or skip a row. `taken_at` orders the grid the
 * way viewers expect (chronological); `id` is the tiebreaker so photos sharing
 * the same `taken_at` (bulk uploads with identical EXIF) keep a stable total
 * order across `.range()` windows. Both ascending — matches the legacy
 * `.order('taken_at')` the un-paginated queries used.
 */
function applyEventPhotoOrder<
  T extends { order(column: string, options: { ascending: boolean }): T },
>(query: T): T {
  return query.order('taken_at', { ascending: true }).order('id', { ascending: true });
}

/**
 * Column list for public gallery reads — includes `user_id` (row owner) for
 * client-side ownership checks, omits the owner-only `guest_email`. Shared by
 * {@link getEventPhotosPublic} and its paginated variant so the two can't drift.
 */
const EVENT_PHOTO_PUBLIC_COLUMNS =
  'id, original_url, taken_at, city, country, state, user_id, uploaded_by, guest_name, width, height, thumbnail_status, thumb_version';

/**
 * Column list for owner/dashboard gallery reads — includes `guest_email` and
 * `upload_status` (both owner-only). Shared by {@link getEventPhotos} and its
 * paginated variant.
 */
const EVENT_PHOTO_OWNER_COLUMNS =
  'id, original_url, taken_at, city, country, uploaded_by, guest_name, guest_email, upload_status, width, height, thumbnail_status, thumb_version';

/**
 * Count photos uploaded by a user that are attached to a non-soft-deleted
 * event. Backs the photographer dashboard "photos uploaded" metric.
 *
 * Filters:
 *   - `user_id = userId` — owner-scoped.
 *   - `events!inner` — inner-join via Postgrest's relational select. Drops
 *     photos whose joined event doesn't satisfy the conjunction below.
 *     `event_id` is `NOT NULL` at the schema level (post-migration), so
 *     this also acts as a redundant null filter — defense in depth in
 *     case the constraint is ever relaxed.
 *   - `events.deleted_at IS NULL` — exclude photos whose event was
 *     soft-deleted. Those rows still exist for analytics + restoration
 *     but should not inflate the "uploaded" count surfaced to the user.
 *
 * Pre-migration this query returned ~85 for a user with 45 visible
 * photos because 40 historical orphans (event_id NULL) were counted.
 * Post-migration the orphans are gone AND this filter would have caught
 * them anyway.
 */
export async function getPhotosUploadedCount(
  supabase: SupabaseServerClient,
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<number> {
  let query = supabase
    .from('photos')
    .select('id, events!inner(deleted_at)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('events.deleted_at', null);

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', endDate);

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to count photos: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Sum `size_bytes` across photos owned by a user that are attached to a
 * non-soft-deleted event. Backs the storage meter on the photographer
 * dashboard and the per-upload plan-limit check in `lib/plan-limits.ts`.
 *
 * Mirrors `getPhotosUploadedCount`'s filter set so the two surfaces never
 * disagree about what's "active" storage. Without this join, soft-deleted
 * events kept charging the photographer's plan quota — which is the bug
 * a 45-visible / 85-counted discrepancy exposed.
 *
 * Rows with NULL `size_bytes` (legacy data from before the column was
 * added) contribute 0.
 */
export async function getStorageUsageBytes(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('photos')
    .select('size_bytes, events!inner(deleted_at)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('events.deleted_at', null);

  if (error) {
    throw new Error(`Failed to compute storage usage: ${getErrorMessage(error)}`);
  }

  return (data ?? []).reduce<number>(
    (acc, row) => acc + (typeof row.size_bytes === 'number' ? row.size_bytes : 0),
    0,
  );
}

/**
 * Count non-rejected photos for an event. Used to enforce the
 * `MAX_PHOTOS_PER_EVENT` cap when minting signed upload URLs — `rejected`
 * photos don't occupy storage and shouldn't count toward the limit.
 *
 * Pending photos DO count: a pending photo has bytes in Storage waiting on
 * worker validation. Treating it as 0 would let a caller race the worker
 * and exceed the cap.
 */
export async function countEventPhotos(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .neq('upload_status', 'rejected');

  if (error) {
    throw new Error(`Failed to count event photos: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Get photos for multiple events. Excludes pending uploads so dashboard grids
 * and search results only show photos visible to viewers.
 */
export async function getPhotosForEvents(
  supabase: SupabaseServerClient,
  eventIds: string[],
): Promise<PhotoSummary[]> {
  if (eventIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('photos')
    .select('event_id, original_url, taken_at, thumbnail_status, thumb_version')
    .in('event_id', eventIds)
    .eq('upload_status', 'approved')
    .is('deleted_at', null)
    .order('taken_at', { ascending: true })
    .throwOnError();

  if (error) {
    throw new Error(`Failed to get photos for events: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as PhotoSummary[];
}

/**
 * Like {@link getPhotosForEvents}, but also includes `pending` uploads (not yet
 * promoted to `approved` by the face-indexing worker) and the row's own
 * `upload_status`, so callers can decide per-event whether to trust pending
 * photos or narrow back to approved-only themselves (T-072).
 *
 * Rejected photos are still excluded — they failed validation and aren't real
 * content. Used by the owner's own dashboard (always show what was uploaded)
 * and by public surfaces that gate on `upload_status` conditionally: an event
 * with AI matching configured genuinely benefits from waiting for its
 * indexing pipeline to promote photos; an event without AI matching has no
 * such pipeline to wait on, so pending is the honest signal there.
 */
export async function getPhotosForEventsIncludingPending(
  supabase: SupabaseServerClient,
  eventIds: string[],
): Promise<PhotoSummary[]> {
  if (eventIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('photos')
    .select('event_id, original_url, taken_at, thumbnail_status, thumb_version, upload_status')
    .in('event_id', eventIds)
    .in('upload_status', ['pending', 'approved'])
    .is('deleted_at', null)
    .order('taken_at', { ascending: true })
    .throwOnError();

  if (error) {
    throw new Error(
      `Failed to get photos (including pending) for events: ${getErrorMessage(error)}`,
    );
  }

  return (data ?? []) as PhotoSummary[];
}

/**
 * Return the total uploaded photo count per event for the photographer's
 * own dashboard cards. Counts `pending + approved` photos (= everything the
 * photographer submitted) so the number is stable from the moment of upload
 * and doesn't grow as the Inngest worker promotes photos from `pending` to
 * `approved`. Rejected photos are excluded — they failed validation and are
 * not real content the photographer owns.
 *
 * Public-facing surfaces should continue to show approved-only counts; this
 * function is intentionally scoped to owner-only dashboard contexts.
 */
export async function getPhotoCountsForEvents(
  supabase: SupabaseServerClient,
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('photos')
    .select('event_id')
    .in('event_id', eventIds)
    .in('upload_status', ['pending', 'approved'])
    .is('deleted_at', null)
    .throwOnError();

  if (error) {
    throw new Error(`Failed to get photo counts for events: ${getErrorMessage(error)}`);
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.event_id) continue;
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Get photos for a single event (owner-scoped). Defaults to approved only;
 * pass `status: 'pending'` to fetch the moderation queue.
 *
 * Pass `skipUserIdFilter: true` when the caller has already verified event
 * ownership AND is using the service-role client (so RLS doesn't apply).
 * This is required for collaborative events: guest uploads land at storage
 * paths under `collaborative/{event_id}/...` which the cookie client can't
 * sign per the storage RLS policy `{auth.uid()}/...`. With skipUserIdFilter
 * + admin client, owner sees every photo regardless of who uploaded it.
 */
export async function getEventPhotos(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
  options?: GetEventPhotosOptions,
): Promise<PhotoDetail[]> {
  let query = supabase
    .from('photos')
    .select(EVENT_PHOTO_OWNER_COLUMNS)
    .eq('event_id', eventId)
    .is('deleted_at', null);

  if (options?.includePending) {
    // Owner-side widening: show photos still mid-validation in the grid so the
    // photographer sees their upload-in-progress state, not a phantom gap.
    // Rejected photos stay hidden — they're surfaced via the toast.
    query = query.in('upload_status', ['approved', 'pending']);
  } else {
    query = query.eq('upload_status', options?.status ?? 'approved');
  }
  if (!options?.skipUserIdFilter) {
    query = query.eq('user_id', userId);
  }
  if (options?.excludeOwnerUploads) {
    // Keep a row only if it is NOT an owner upload: either it belongs to a
    // different user (organizer-contributor) OR it carries a guest name
    // (guest-collaborative, whose user_id is the owner). Mirrors `isOwnerUpload`
    // in the face indexer's promote-upload-status step.
    query = query.or(`user_id.neq.${userId},guest_name.not.is.null`);
  }

  const { data, error } = await query.order('taken_at', { ascending: true }).throwOnError();

  if (error) {
    throw new Error(`Failed to get event photos: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as PhotoDetail[];
}

/**
 * Get approved photos for an event by event ID (public access, no user check).
 * Includes uploader attribution fields (`uploaded_by`, `guest_name`) so the
 * public viewer can render the contributor badge. Email is intentionally
 * excluded — only the event owner sees that, via the dashboard.
 */
export async function getEventPhotosPublic(
  supabase: SupabaseServerClient,
  eventId: string,
): Promise<PhotoDetail[]> {
  const { data, error } = await supabase
    .from('photos')
    .select(EVENT_PHOTO_PUBLIC_COLUMNS)
    .eq('event_id', eventId)
    .eq('upload_status', 'approved')
    .is('deleted_at', null)
    .order('taken_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get event photos: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as PhotoDetail[];
}

/**
 * Paginated variant of {@link getEventPhotosPublic}. Fetches one gallery page
 * (approved photos only) in the deterministic `(taken_at, id)` order and
 * reports whether more remain. Over-fetches one row (`limit + 1`) so `hasMore`
 * is exact without a separate count query.
 */
export async function getEventPhotosPublicPage(
  supabase: SupabaseServerClient,
  eventId: string,
  { limit, offset }: EventPhotoPageOptions,
): Promise<{ photos: PhotoDetail[]; hasMore: boolean }> {
  const query = supabase
    .from('photos')
    .select(EVENT_PHOTO_PUBLIC_COLUMNS)
    .eq('event_id', eventId)
    .eq('upload_status', 'approved')
    .is('deleted_at', null);

  // Inclusive range → fetches limit+1 rows; the extra row proves `hasMore`.
  const { data, error } = await applyEventPhotoOrder(query).range(offset, offset + limit);

  if (error) {
    throw new Error(`Failed to get event photos page: ${getErrorMessage(error)}`);
  }

  const rows = (data ?? []) as PhotoDetail[];
  const hasMore = rows.length > limit;
  return { photos: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * Paginated, owner-scoped variant of {@link getEventPhotos}. Mirrors its
 * filter semantics (`includePending` / `status` / `skipUserIdFilter`) and adds
 * the same deterministic order + `limit + 1` over-fetch as
 * {@link getEventPhotosPublicPage}.
 */
export async function getEventPhotosPage(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
  options: GetEventPhotosOptions & EventPhotoPageOptions,
): Promise<{ photos: PhotoDetail[]; hasMore: boolean }> {
  let query = supabase
    .from('photos')
    .select(EVENT_PHOTO_OWNER_COLUMNS)
    .eq('event_id', eventId)
    .is('deleted_at', null);

  if (options.includePending) {
    query = query.in('upload_status', ['approved', 'pending']);
  } else {
    query = query.eq('upload_status', options.status ?? 'approved');
  }
  if (!options.skipUserIdFilter) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await applyEventPhotoOrder(query).range(
    options.offset,
    options.offset + options.limit,
  );

  if (error) {
    throw new Error(`Failed to get event photos page: ${getErrorMessage(error)}`);
  }

  const rows = (data ?? []) as PhotoDetail[];
  const hasMore = rows.length > options.limit;
  return { photos: hasMore ? rows.slice(0, options.limit) : rows, hasMore };
}

/**
 * Count an event's photos by upload status (defaults to approved-only). Backs
 * the "real total" the paginated gallery shows even though it renders only the
 * first page — the public JSON-LD `numberOfItems` and the like.
 *
 * NOTE: distinct from {@link countEventPhotos}, which counts approved + pending
 * for the upload-cap check. This one is status-parameterized and defaults to
 * the public (approved-only) total.
 */
export async function countEventPhotosByStatus(
  supabase: SupabaseServerClient,
  eventId: string,
  statuses: UploadStatus[] = ['approved'],
): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('upload_status', statuses)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to count event photos by status: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Photo ids in an event uploaded by a given user — either as the row owner
 * (`user_id`, authenticated uploads) or as a guest contributor later linked to
 * the account (`uploaded_by`). Backs the talent "My photos" filter, which must
 * see the COMPLETE set of the viewer's uploads regardless of gallery
 * pagination (a match on page 3 still belongs under "My photos"). Must be
 * called with the service-role client for collaborative events, where guest
 * rows live outside the caller's RLS scope.
 */
export async function getUploadedPhotoIdsForUserInEvent(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id')
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .or(`user_id.eq.${userId},uploaded_by.eq.${userId}`);

  if (error) {
    throw new Error(`Failed to get uploaded photo ids: ${getErrorMessage(error)}`);
  }

  return (data ?? []).map((row) => row.id as string);
}

/**
 * Get photo storage paths for an event
 */
export async function getPhotoStoragePaths(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
  excludePhotoIds: string[] = [],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, original_url')
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get photo storage paths: ${getErrorMessage(error)}`);
  }

  // Keep the original files for purchased photos — buyers access them via
  // short-lived signed URLs, so deleting storage would break their downloads.
  const excluded = new Set(excludePhotoIds);
  return (data ?? [])
    .filter((photo) => !excluded.has(photo.id as string))
    .map((photo) => photo.original_url)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);
}

/**
 * Get a single photo by ID
 */
export async function getPhoto(
  supabase: SupabaseServerClient,
  photoId: string,
  eventId: string,
  userId: string,
): Promise<Photo | null> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, original_url')
    .eq('id', photoId)
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Photo | null;
}

/**
 * Create a photo record. Returns the inserted row's id so callers can
 * forward it to background workers (e.g. Inngest `photo.uploaded` events
 * carry the photo id).
 */
export async function createPhoto(
  supabase: SupabaseServerClient,
  userId: string,
  photoData: {
    event_id: string;
    original_url: string;
    taken_at: string;
    city: string;
    country: string;
    state: string | null;
    size_bytes: number;
    // Optional. Defaults to 'approved' on insert (the column default). Pass
    // 'pending' for organizer-event uploads when the event requires approval,
    // OR for the direct-upload flow where photos sit 'pending' until the
    // Inngest worker has validated their bytes.
    upload_status?: UploadStatus;
    /** User-supplied filename, kept for download-suggestion display only. */
    original_filename?: string | null;
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('photos')
    .insert({
      user_id: userId,
      ...photoData,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create photo: ${getErrorMessage(error)}`);
  }

  return { id: data.id as string };
}

/**
 * Insert a photo uploaded by a guest contributor on a collaborative event.
 * Must be called with the service-role client because guests have no auth
 * session and the photos table RLS only allows owner inserts. The row
 * inherits the event owner's user_id so existing owner-scoped queries and
 * delete paths continue to work.
 */
export async function uploadGuestPhoto(
  supabase: SupabaseServerClient,
  photoData: {
    event_id: string;
    owner_user_id: string;
    uploaded_by: string | null;
    guest_name: string | null;
    guest_email: string | null;
    original_url: string;
    upload_status: UploadStatus;
    delete_token: string | null;
    taken_at?: string | null;
    size_bytes: number;
  },
): Promise<{ id: string; delete_token: string | null }> {
  const { data, error } = await supabase
    .from('photos')
    .insert({
      user_id: photoData.owner_user_id,
      event_id: photoData.event_id,
      uploaded_by: photoData.uploaded_by,
      guest_name: photoData.guest_name,
      guest_email: photoData.guest_email,
      original_url: photoData.original_url,
      upload_status: photoData.upload_status,
      delete_token: photoData.delete_token,
      taken_at: photoData.taken_at ?? null,
      size_bytes: photoData.size_bytes,
    })
    .select('id, delete_token')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert guest photo: ${error ? getErrorMessage(error) : 'Unknown error'}`,
    );
  }

  return {
    id: data.id as string,
    delete_token: (data.delete_token as string | null) ?? null,
  };
}

/**
 * Persist a photo's displayed pixel dimensions. Called by the Inngest worker
 * after it downloads and validates the uploaded bytes — the direct-upload
 * flow never has the bytes inside a Server Action, so dimensions are filled
 * in here rather than at `createPhoto`/`uploadGuestPhoto` time.
 */
export async function updatePhotoDimensions(
  supabase: SupabaseServerClient,
  photoId: string,
  width: number,
  height: number,
): Promise<void> {
  const { error } = await supabase.from('photos').update({ width, height }).eq('id', photoId);

  if (error) {
    throw new Error(`Failed to update photo dimensions: ${getErrorMessage(error)}`);
  }
}

/**
 * Service-role only. List photos whose thumbnail never got baked: face indexing
 * reached a terminal state (`indexed` / `no_faces` / `not_applicable`, so a
 * `photo.processed` was due) but `thumbnail_status` is still `'pending'`, and
 * the photo was uploaded before `staleBeforeIso`. Used by the reconciliation
 * cron (T-099) to re-emit the bake for photos whose `photo.processed` emit was
 * lost — otherwise the gallery serves the per-view `/api/watermark` fallback
 * (paying its cost) forever.
 *
 * The age gate uses `created_at` (upload time). A photo mid-index is excluded by
 * the terminal-status filter (its `face_index_status` is still `pending` /
 * `indexing`), so a live re-index of an old photo can't be swept until it
 * genuinely settles — by which point its bake has been (re-)emitted.
 */
export async function listPhotosWithStuckThumbnails(
  supabase: SupabaseServerClient,
  staleBeforeIso: string,
  limit: number,
): Promise<Array<{ id: string; eventId: string; storagePath: string }>> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, event_id, original_url')
    .eq('thumbnail_status', 'pending')
    .in('face_index_status', ['indexed', 'no_faces', 'not_applicable'])
    .lt('created_at', staleBeforeIso)
    .not('original_url', 'is', null)
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list photos with stuck thumbnails: ${getErrorMessage(error)}`);
  }
  return (data ?? [])
    .filter((row) => row.original_url)
    .map((row) => ({
      id: row.id as string,
      eventId: row.event_id as string,
      storagePath: row.original_url as string,
    }));
}

export async function updatePhotoThumbnailStatus(
  supabase: SupabaseServerClient,
  photoId: string,
  status: ThumbnailStatus,
): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ thumbnail_status: status })
    .eq('id', photoId);

  if (error) {
    throw new Error(`Failed to update photo thumbnail_status: ${getErrorMessage(error)}`);
  }
}

/**
 * Flip `thumbnail_status` to `'ready'` AND bump `thumb_version` (T-078).
 *
 * The version bump is what makes a re-bake reach already-cached galleries: the
 * /api/thumb URL is content-addressed + served `immutable, max-age=1y`, so
 * re-baking a blurred thumbnail over the same path would otherwise keep serving
 * the stale, unblurred copy. Bumping the version changes the `?v=N` suffix →
 * fresh CDN cache key. Called once per successful bake (`mark-ready` step).
 *
 * The read-then-write is race-free in practice: one bake runs per photo (a
 * single `photo.processed` per index settle), and Inngest step memoization
 * keeps a retried function from re-running an already-succeeded `mark-ready`.
 */
export async function markPhotoThumbnailReady(
  supabase: SupabaseServerClient,
  photoId: string,
): Promise<void> {
  const { data, error: readError } = await supabase
    .from('photos')
    .select('thumb_version')
    .eq('id', photoId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read thumb_version: ${getErrorMessage(readError)}`);
  }

  const nextVersion = ((data?.thumb_version as number | null) ?? 0) + 1;

  const { error } = await supabase
    .from('photos')
    .update({ thumbnail_status: 'ready', thumb_version: nextVersion })
    .eq('id', photoId);

  if (error) {
    throw new Error(`Failed to mark photo thumbnail ready: ${getErrorMessage(error)}`);
  }
}

/**
 * Fetch the minimum information needed to authorize a contributor delete:
 * the photo itself plus the owning event's user_id (for the owner-bypass
 * case). Returns null if not found. Must be called with the service-role
 * client; RLS would otherwise hide the photo from anonymous guests trying
 * to delete their own contributions.
 */
export async function getPhotoForContributorDelete(
  supabase: SupabaseServerClient,
  photoId: string,
  eventId: string,
): Promise<{
  id: string;
  original_url: string | null;
  user_id: string;
  uploaded_by: string | null;
  delete_token: string | null;
  event_owner_id: string;
} | null> {
  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, original_url, user_id, uploaded_by, delete_token, events!inner(user_id, deleted_at)',
    )
    .eq('id', photoId)
    .eq('event_id', eventId)
    .is('events.deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Supabase typing for joined rows is loose; narrow defensively. The inner
  // join returns events as a related object (or array); handle both shapes.
  const eventsField = (data as { events: unknown }).events;
  const eventOwnerId = Array.isArray(eventsField)
    ? ((eventsField[0] as { user_id?: string } | undefined)?.user_id ?? null)
    : ((eventsField as { user_id?: string } | null)?.user_id ?? null);

  if (!eventOwnerId) return null;

  return {
    id: data.id as string,
    original_url: (data.original_url as string | null) ?? null,
    user_id: data.user_id as string,
    uploaded_by: (data.uploaded_by as string | null) ?? null,
    delete_token: (data.delete_token as string | null) ?? null,
    event_owner_id: eventOwnerId,
  };
}

/**
 * Photo file + its event's owner and pricing — backs the single-photo
 * download permission check on the public event page. Returns null when the
 * photo isn't an approved photo of the given (non-deleted) event.
 */
export async function getPhotoForDownload(
  supabase: SupabaseServerClient,
  photoId: string,
  eventId: string,
): Promise<{
  id: string;
  original_url: string | null;
  original_filename: string | null;
  event_owner_id: string;
  price_per_photo: number | null;
  deleted_at: string | null;
} | null> {
  // NOTE: no `photos.deleted_at` filter — a soft-deleted-after-sale photo must
  // still be resolvable so its BUYER can download it (T-142). The photo's
  // `deleted_at` is RETURNED so the caller can deny the free/owner all-access
  // branch (which must not serve a retained photo) while still honoring the
  // buyer's purchased-set path.
  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, original_url, original_filename, deleted_at, events!inner(user_id, price_per_photo, deleted_at)',
    )
    .eq('id', photoId)
    .eq('event_id', eventId)
    .eq('upload_status', 'approved')
    .is('events.deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Supabase typing for joined rows is loose; the inner join returns events
  // as a related object (or array) — handle both shapes.
  const eventsField = (data as { events: unknown }).events;
  const event = Array.isArray(eventsField)
    ? (eventsField[0] as { user_id?: string; price_per_photo?: number | null } | undefined)
    : (eventsField as { user_id?: string; price_per_photo?: number | null } | null);

  if (!event?.user_id) return null;

  return {
    id: data.id as string,
    original_url: (data.original_url as string | null) ?? null,
    original_filename: (data.original_filename as string | null) ?? null,
    event_owner_id: event.user_id,
    price_per_photo: event.price_per_photo ?? null,
    deleted_at: (data as { deleted_at: string | null }).deleted_at ?? null,
  };
}

/**
 * Update a photo's upload_status (owner-only via RLS user_id = auth.uid()).
 * Currently the only legitimate transition is pending -> approved; reject is
 * a hard delete handled separately.
 */
export async function updatePhotoUploadStatus(
  supabase: SupabaseServerClient,
  params: {
    photoId: string;
    eventId: string;
    status: UploadStatus;
  },
): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ upload_status: params.status })
    .eq('id', params.photoId)
    .eq('event_id', params.eventId);

  if (error) {
    throw new Error(`Failed to update photo upload status: ${getErrorMessage(error)}`);
  }
}

/**
 * Delete a photo
 */
export async function deletePhoto(
  supabase: SupabaseServerClient,
  photoId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('photos').delete().eq('id', photoId).eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete photo: ${getErrorMessage(error)}`);
  }
}

// ─── Moderation-queue bulk ops (T-109) ────────────────────────────────────────
//
// These are event-scoped (filter on `event_id`, NOT `user_id`) and are meant to
// be called with the service-role client AFTER the caller has verified the
// event owner. Scoping by user_id would silently skip organizer-contributor
// uploads (whose `user_id` is the contributor, not the owner) — the RLS/filter
// mismatch that let the moderation queue show photos it could neither approve
// nor reject. Each is a single statement over the id set, so a batch either
// applies as one write or fails as one (no partial-prefix left behind).

/**
 * Bulk-set `upload_status` for a set of photos within one event.
 */
export async function setEventPhotosUploadStatus(
  supabase: SupabaseServerClient,
  eventId: string,
  photoIds: string[],
  status: UploadStatus,
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabase
    .from('photos')
    .update({ upload_status: status })
    .eq('event_id', eventId)
    .in('id', photoIds);

  if (error) {
    throw new Error(`Failed to set photo upload status: ${getErrorMessage(error)}`);
  }
}

/**
 * Storage paths (`original_url`) for a set of photos within one event — read
 * before a bulk delete so the storage objects can be cleaned up too.
 */
export async function getEventPhotoStoragePaths(
  supabase: SupabaseServerClient,
  eventId: string,
  photoIds: string[],
): Promise<string[]> {
  if (photoIds.length === 0) return [];
  const { data, error } = await supabase
    .from('photos')
    .select('original_url')
    .eq('event_id', eventId)
    .in('id', photoIds);

  if (error) {
    throw new Error(`Failed to read photo storage paths: ${getErrorMessage(error)}`);
  }
  return (data ?? [])
    .map((row) => (row as { original_url: string | null }).original_url)
    .filter((url): url is string => Boolean(url));
}

/**
 * Bulk hard-delete a specific set of photos within one event (no undo).
 * Distinct from {@link deleteEventPhotos}, which clears a whole event.
 */
export async function deleteEventPhotosByIds(
  supabase: SupabaseServerClient,
  eventId: string,
  photoIds: string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabase
    .from('photos')
    .delete()
    .eq('event_id', eventId)
    .in('id', photoIds);

  if (error) {
    throw new Error(`Failed to delete photos: ${getErrorMessage(error)}`);
  }
}

/**
 * Photo ids in an event that back a real purchase — referenced by `order_items`
 * or `guest_order_items` (both `ON DELETE RESTRICT`). These must survive an
 * event delete: they hold sales records and the buyer still needs the original.
 *
 * Event-wide across ALL buyers (incl. guest orders) — distinct from
 * `orders.getPurchasedPhotoIdsForEvent`, which is scoped to one buyer.
 *
 * Reads the order tables, so it MUST be called with a service-role client —
 * `order_items` RLS scopes rows to the buyer, not the photographer. Ownership
 * is enforced by the caller (the event is fetched user-scoped first).
 */
export async function getSoldPhotoIdsForEvent(
  supabaseAdmin: SupabaseServerClient,
  eventId: string,
): Promise<string[]> {
  const { data: photos, error: photosError } = await supabaseAdmin
    .from('photos')
    .select('id')
    .eq('event_id', eventId);
  if (photosError) {
    throw new Error(`Failed to list event photos: ${getErrorMessage(photosError)}`);
  }
  const ids = (photos ?? []).map((p) => p.id as string);
  if (ids.length === 0) return [];

  // Delegate to the per-id predicate so "sold" is derived in exactly one place.
  return [...(await getSoldPhotoIds(supabaseAdmin, ids))];
}

/**
 * Given a set of photo ids, return the subset that has been SOLD — i.e. appears
 * in a completed `order_items` OR `guest_order_items` row (T-142). This is the
 * per-photo generalization of {@link getSoldPhotoIdsForEvent}; the delete paths
 * use it to decide soft-delete-and-retain (sold) vs hard-delete (unsold).
 *
 * MUST run on the service-role client: the order-items tables are RLS-scoped to
 * the buyer, so a photographer's user-scoped client cannot see another user's
 * purchase of their photo.
 */
export async function getSoldPhotoIds(
  supabaseAdmin: SupabaseServerClient,
  photoIds: string[],
): Promise<Set<string>> {
  if (photoIds.length === 0) return new Set();

  const [orderItems, guestOrderItems] = await Promise.all([
    supabaseAdmin.from('order_items').select('photo_id').in('photo_id', photoIds),
    supabaseAdmin.from('guest_order_items').select('photo_id').in('photo_id', photoIds),
  ]);
  if (orderItems.error) {
    throw new Error(`Failed to check order items: ${getErrorMessage(orderItems.error)}`);
  }
  if (guestOrderItems.error) {
    throw new Error(`Failed to check guest order items: ${getErrorMessage(guestOrderItems.error)}`);
  }

  const sold = new Set<string>();
  for (const row of orderItems.data ?? []) sold.add(row.photo_id as string);
  for (const row of guestOrderItems.data ?? []) sold.add(row.photo_id as string);
  return sold;
}

/**
 * Convenience wrapper: has this single photo been sold? See
 * {@link getSoldPhotoIds}. Must run on the service-role client.
 */
export async function isPhotoSold(
  supabaseAdmin: SupabaseServerClient,
  photoId: string,
): Promise<boolean> {
  const sold = await getSoldPhotoIds(supabaseAdmin, [photoId]);
  return sold.has(photoId);
}

/**
 * Soft-delete photos (T-142): stamp `deleted_at` while keeping the row and its
 * storage object, so a buyer who purchased the photo keeps permanent access
 * while it disappears from every photographer/public/gallery/search/cart
 * surface. Idempotent — re-stamping an already soft-deleted row is harmless.
 *
 * Runs on the service-role client: the caller has already authorized the delete,
 * and this avoids depending on a `photos` UPDATE RLS policy for the owner.
 */
export async function softDeletePhotosByIds(
  supabaseAdmin: SupabaseServerClient,
  photoIds: string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('photos')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', photoIds);
  if (error) {
    throw new Error(`Failed to soft-delete photos: ${getErrorMessage(error)}`);
  }
}

/**
 * Delete all photos for an event, optionally excluding a set of photo ids
 * (e.g. purchased photos that can't be removed — see
 * {@link getPurchasedPhotoIdsForEvent}).
 */
export async function deleteEventPhotos(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
  excludePhotoIds: string[] = [],
): Promise<void> {
  let query = supabase.from('photos').delete().eq('event_id', eventId).eq('user_id', userId);
  if (excludePhotoIds.length > 0) {
    query = query.not('id', 'in', `(${excludePhotoIds.join(',')})`);
  }

  const { error } = await query;
  if (error) {
    throw new Error(`Failed to delete event photos: ${getErrorMessage(error)}`);
  }
}

/**
 * The single source of truth for "is this photo currently purchasable" (T-117):
 * its row exists, `upload_status = 'approved'`, and its event hasn't been
 * soft-deleted. Used by guest-cart validation, the authenticated cart's
 * self-heal-on-load, and both checkout paths' pre-charge re-validation — never
 * re-derive this filter inline at a call site.
 */
export async function getPurchasablePhotoIds(
  supabase: SupabaseServerClient,
  photoIds: string[],
): Promise<Set<string>> {
  if (photoIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('photos')
    .select('id, events!inner(deleted_at)')
    .in('id', photoIds)
    .eq('upload_status', 'approved')
    .is('deleted_at', null)
    .is('events.deleted_at', null);

  if (error) {
    throw new Error(`Failed to get purchasable photo ids: ${getErrorMessage(error)}`);
  }

  return new Set((data ?? []).map((row) => row.id as string));
}

/**
 * The single access rule for "may a caller BUY this event's photos" (T-132).
 * Purchasability (approved + event alive) is not the same as access: a private
 * event (`is_public = false`) is reachable only through its `share_code` — the
 * bearer token the photographer shares. So a photo is buyable iff its event is
 * public, OR the caller presents a share code matching the event's own
 * `share_code`. Keeping this a pure function means the add-to-cart gate, the
 * batch predicate below, and both checkout paths all decide access identically
 * — never re-derive `is_public || code` inline.
 *
 * `shareCodes` is the union of codes the caller has demonstrably seen (the URL
 * of a `/events/[shareCode]` page, or the per-item code the guest cart stashed
 * at add time). The match is still per-event: a code only unlocks the event it
 * belongs to, so presenting event A's code never grants access to event B.
 */
export function isEventAccessible(
  event: { is_public: boolean | null; share_code: string | null },
  shareCodes: string[],
): boolean {
  if (event.is_public === true) return true;
  return event.share_code !== null && shareCodes.includes(event.share_code);
}

/** The access-relevant event fields for one photo (T-132/T-134). */
type PhotoEventAccess = { is_public: boolean | null; share_code: string | null };

/**
 * Load the access-relevant event fields (`is_public`, `share_code`) for a set
 * of photos, keyed by photo id — the shared fetch both accessibility helpers
 * below build on, so the PostgREST `events!inner` embed shape is normalized in
 * exactly one place. Pass `supabaseAdmin`: the buyer isn't the photo's owner.
 */
async function getEventAccessByPhotoIds(
  supabase: SupabaseServerClient,
  photoIds: string[],
): Promise<Map<string, PhotoEventAccess>> {
  const map = new Map<string, PhotoEventAccess>();
  if (photoIds.length === 0) return map;

  const { data, error } = await supabase
    .from('photos')
    .select('id, events!inner(is_public, share_code)')
    .in('id', photoIds);

  if (error) {
    throw new Error(`Failed to load event access by photo ids: ${getErrorMessage(error)}`);
  }

  for (const row of data ?? []) {
    const event = Array.isArray(row.events) ? row.events[0] : row.events;
    if (event) map.set(row.id as string, event);
  }
  return map;
}

/**
 * Of `photoIds`, the subset whose event is ACCESSIBLE to a caller presenting
 * `shareCodes` (T-132) — the batch companion to {@link isEventAccessible},
 * applied at the guest-cart boundaries (load, merge, checkout) where a request
 * carries several photos across possibly-different events. Pair it with
 * {@link getPurchasablePhotoIds} (state) — a photo must be BOTH accessible and
 * purchasable to be bought. Pass `supabaseAdmin`: the buyer isn't the photo's
 * owner, so a user-scoped read is RLS-filtered.
 */
export async function getAccessiblePhotoIds(
  supabase: SupabaseServerClient,
  photoIds: string[],
  shareCodes: string[],
): Promise<Set<string>> {
  const eventByPhotoId = await getEventAccessByPhotoIds(supabase, photoIds);

  const accessible = new Set<string>();
  for (const [photoId, event] of eventByPhotoId) {
    if (isEventAccessible(event, shareCodes)) accessible.add(photoId);
  }
  return accessible;
}

/**
 * Of the authenticated cart `items`, the subset of photo ids the buyer may
 * still purchase from an ACCESS standpoint (T-134) — the authed-checkout
 * companion to {@link getAccessiblePhotoIds}, which keys off a request-scoped
 * code set. Here each item carries its OWN persisted proof (`accessShareCode`,
 * captured at add time), because the authed cart spans events added at
 * different times with different codes.
 *
 * A photo is accessible iff its event is public now, OR the item's persisted
 * code matches that event's current `share_code` (via the shared
 * {@link isEventAccessible}), OR the buyer still has the photo tagged in their
 * library — the favorites path presents no code, and a live tag is also a
 * legitimate escape hatch when the photographer rotated the code after the
 * buyer saved the photo. Pair with {@link getPurchasablePhotoIds} (state): a
 * photo must be BOTH accessible and purchasable to be bought. Pass
 * `supabaseAdmin`: the buyer isn't the photo's owner.
 */
export async function getAccessibleAuthedCartPhotoIds(
  supabase: SupabaseServerClient,
  items: Array<{ photoId: string; accessShareCode: string | null }>,
  userId: string,
): Promise<Set<string>> {
  if (items.length === 0) return new Set();

  const eventByPhotoId = await getEventAccessByPhotoIds(
    supabase,
    items.map((i) => i.photoId),
  );

  const accessible = new Set<string>();
  const needsTagCheck: string[] = [];
  for (const item of items) {
    const event = eventByPhotoId.get(item.photoId);
    if (!event) continue; // no event row → not accessible (and not purchasable)
    if (isEventAccessible(event, item.accessShareCode ? [item.accessShareCode] : [])) {
      accessible.add(item.photoId);
    } else {
      needsTagCheck.push(item.photoId);
    }
  }

  // Only the items no code cleared fall back to the live tag check — one
  // batched lookup against the buyer's own library, never per-item.
  if (needsTagCheck.length > 0) {
    const { data: tags, error: tagError } = await supabase
      .from('talent_photo_tags')
      .select('photo_id')
      .eq('talent_user_id', userId)
      .in('photo_id', needsTagCheck);
    if (tagError) {
      throw new Error(`Failed to check cart tag ownership: ${getErrorMessage(tagError)}`);
    }
    for (const tag of tags ?? []) accessible.add(tag.photo_id as string);
  }

  return accessible;
}

export interface PreviewPolicy {
  /**
   * The event's watermark policy: `true`/`false` when positively known,
   * `null` when it isn't — callers must fail closed on `null`.
   */
  watermarkEnabled: boolean | null;
  /** Indexed face boxes for the photo (service-role-written, trustworthy). */
  faceBoxes: Array<{ boundingBox: Record<string, number>; confidence: number }>;
}

/**
 * The watermark policy + indexed face boxes for the photo stored at
 * `storagePath`, looked up server-side by the `/api/watermark/` route to pick
 * its treatment (T-133) — never trusted from anything the caller sends, since
 * the route is unauthenticated and path-addressable. One query replaces the
 * previous separate policy + face-box lookups (both filtered the same
 * unindexed `original_url`).
 *
 * A photo row only counts if it is BOUND to the path it claims: storage paths
 * are `${storageOwnerId}/${eventId}/${uuid}.${ext}` (enforced at upload), so
 * the row's `event_id` must equal the path's event segment. Photos RLS
 * (`own_photos_mutate`) only checks `user_id = auth.uid()`, so any
 * authenticated user can insert a row with an ARBITRARY `original_url`
 * pointing at someone else's object and attach it to their own no-watermark
 * event — without the binding check, such a planted row could trick the route
 * into serving a clean (un-watermarked) copy of a victim's payment-gated
 * photo whenever the victim's own row is absent (orphan-cleanup window). A
 * BOUND row can only tell the truth: its event embed IS the path's event.
 * Unbound rows are ignored; no bound row → `null` (fail closed to the
 * watermark treatment). No `.maybeSingle()`: `original_url` has no unique
 * constraint, and a legitimate duplicate must degrade to fail-closed, not
 * error the whole lookup.
 *
 * Pass a service-role client: the requester is an anonymous viewer.
 */
export async function getPreviewPolicyByStoragePath(
  supabase: SupabaseServerClient,
  storagePath: string,
): Promise<PreviewPolicy> {
  const pathEventId = storagePath.split('/')[1] ?? '';

  const { data, error } = await supabase
    .from('photos')
    .select('event_id, events(watermark_enabled), photo_faces(bounding_box, confidence)')
    .eq('original_url', storagePath);

  if (error) {
    throw new Error(`Failed to look up preview policy: ${getErrorMessage(error)}`);
  }

  const boundRows = (data ?? []).filter((row) => row.event_id === pathEventId);
  if (boundRows.length === 0) return { watermarkEnabled: null, faceBoxes: [] };

  // All bound rows reference the same event (same event_id), so their policy
  // can only disagree via a missing embed — treat that as unknown.
  let watermarkEnabled: boolean | null = null;
  const policies = boundRows.map((row) => {
    const event = Array.isArray(row.events) ? row.events[0] : row.events;
    return typeof event?.watermark_enabled === 'boolean' ? event.watermark_enabled : null;
  });
  if (policies.every((p) => p === false)) watermarkEnabled = false;
  else if (policies.every((p) => p === true)) watermarkEnabled = true;

  const faceBoxes = boundRows.flatMap((row) =>
    (row.photo_faces ?? [])
      .filter((face) => face.bounding_box !== null)
      .map((face) => ({
        boundingBox: face.bounding_box as Record<string, number>,
        confidence: Number(face.confidence ?? 0),
      })),
  );

  return { watermarkEnabled, faceBoxes };
}

/**
 * Resolve display preview URLs for a set of photos, keyed by photo id — the
 * single source both cart surfaces share (T-130, extracted from T-115's
 * guest-cart resolution). Serves the baked immutable thumbnail (`/api/thumb`)
 * when `thumbnail_status='ready'`, falling back to the original while the
 * thumbnail hasn't baked yet.
 *
 * The pre-bake fallback must never expose more than the steady state (the
 * public `medium` thumb) does, so it partitions by what there is to protect
 * (T-131 watermark, T-133 resolution):
 *  - anything FOR-SALE (`price_per_photo` non-null, including 0 — matching
 *    `isForSale` and the download gates) or watermarked → the fail-closed
 *    `/api/watermark/` route, which picks the treatment server-side from the
 *    event's own policy: tiled watermark for `watermark_enabled` events,
 *    clean medium-budget downscale for events that sell without a visible
 *    mark. Either way the payment-gated full-resolution original is NEVER
 *    served (the invariant "full resolution only after purchase"). Needs
 *    `baseUrl` to build absolute watermark URLs — a missing/blank one fails
 *    closed to `null` (icon fallback), never the raw original.
 *  - only an event positively known to be BOTH free (`price_per_photo`
 *    null) AND un-watermarked keeps the direct signed original: with no
 *    payment gate there is nothing a "purchase" would grant beyond what the
 *    photographer already gives away, so there is nothing to protect.
 *
 * Pass `supabaseAdmin`: the viewer is a buyer, not the photo's owner, so a
 * user-scoped client can be denied by storage RLS when signing someone
 * else's path — exactly the T-130 bug this replaces.
 *
 * Best-effort by design: a failed lookup returns `{}` (missing ids degrade to
 * the caller's icon fallback) rather than breaking the whole cart load.
 */
export async function getPhotoPreviewUrls(
  supabase: SupabaseServerClient,
  photoIds: string[],
  baseUrl: string,
): Promise<Record<string, string | null>> {
  if (photoIds.length === 0) return {};

  const { data: photos, error } = await supabase
    .from('photos')
    .select(
      'id, original_url, thumbnail_status, thumb_version, events(watermark_enabled, price_per_photo)',
    )
    .in('id', photoIds);

  if (error || !photos) {
    // Still best-effort (previews degrade to the icon fallback), but never
    // silently: an outage here blanks every cart preview at once.
    console.error(`getPhotoPreviewUrls: photos lookup failed: ${error?.message ?? 'no rows'}`);
    return {};
  }

  // Only build a fallback for originals that will actually be served — a
  // `ready` thumbnail wins in resolvePhotoPreviewUrl, so touching its original
  // would be a wasted round trip on every cart load in the steady state.
  // Partition the pre-bake window with the shared `needsProtectedPreview`
  // predicate (T-131/T-133/T-136): anything with something to protect goes
  // through the fail-closed `/api/watermark/` route; only an event positively
  // known to be free AND un-watermarked keeps the direct signed original.
  const watermarkPaths: string[] = [];
  const directPaths: string[] = [];
  for (const photo of photos) {
    if (photo.thumbnail_status === 'ready' || photo.original_url === null) continue;
    const event = Array.isArray(photo.events) ? photo.events[0] : photo.events;
    if (needsProtectedPreview(event)) watermarkPaths.push(photo.original_url);
    else directPaths.push(photo.original_url);
  }

  const [watermarkMap, directMap] = await Promise.all([
    createPhotoUrlMap(supabase, 'photos', watermarkPaths, { useWatermark: true, baseUrl }),
    createPhotoUrlMap(supabase, 'photos', directPaths, { expiresIn: 3600, useWatermark: false }),
  ]);
  const signedMap: Record<string, string> = { ...watermarkMap, ...directMap };

  const result: Record<string, string | null> = {};
  for (const photo of photos) {
    result[photo.id] = resolvePhotoPreviewUrl({
      originalUrl: photo.original_url,
      thumbnailStatus: photo.thumbnail_status,
      thumbVersion: photo.thumb_version,
      fallbackSignedUrl: photo.original_url ? (signedMap[photo.original_url] ?? null) : null,
    });
  }

  return result;
}
