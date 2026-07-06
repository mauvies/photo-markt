/**
 * Photo-related database queries
 */

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
    .select('event_id, original_url, taken_at, thumbnail_status')
    .in('event_id', eventIds)
    .eq('upload_status', 'approved')
    .order('taken_at', { ascending: true })
    .throwOnError();

  if (error) {
    throw new Error(`Failed to get photos for events: ${getErrorMessage(error)}`);
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
    .select(
      'id, original_url, taken_at, city, country, uploaded_by, guest_name, guest_email, upload_status, width, height, thumbnail_status',
    )
    .eq('event_id', eventId);

  if (options?.includePending) {
    // Owner-side widening: show photos still mid-validation in the grid so
    // the photographer sees their upload-in-progress state, not a phantom
    // gap. Rejected photos stay hidden — they're surfaced via the toast.
    query = query.in('upload_status', ['approved', 'pending']);
  } else {
    const status = options?.status ?? 'approved';
    query = query.eq('upload_status', status);
  }

  if (!options?.skipUserIdFilter) {
    query = query.eq('user_id', userId);
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
    .select(
      'id, original_url, taken_at, city, country, user_id, uploaded_by, guest_name, width, height, thumbnail_status',
    )
    .eq('event_id', eventId)
    .eq('upload_status', 'approved')
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
    .select(
      'id, original_url, taken_at, city, country, user_id, uploaded_by, guest_name, width, height, thumbnail_status',
    )
    .eq('event_id', eventId)
    .eq('upload_status', 'approved');

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
    .select(
      'id, original_url, taken_at, city, country, uploaded_by, guest_name, guest_email, upload_status, width, height, thumbnail_status',
    )
    .eq('event_id', eventId);

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
    .in('upload_status', statuses);

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
} | null> {
  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, original_url, original_filename, events!inner(user_id, price_per_photo, deleted_at)',
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

  const [orderItems, guestOrderItems] = await Promise.all([
    supabaseAdmin.from('order_items').select('photo_id').in('photo_id', ids),
    supabaseAdmin.from('guest_order_items').select('photo_id').in('photo_id', ids),
  ]);
  if (orderItems.error) {
    throw new Error(`Failed to check order items: ${getErrorMessage(orderItems.error)}`);
  }
  if (guestOrderItems.error) {
    throw new Error(`Failed to check guest order items: ${getErrorMessage(guestOrderItems.error)}`);
  }

  const purchased = new Set<string>();
  for (const row of orderItems.data ?? []) purchased.add(row.photo_id as string);
  for (const row of guestOrderItems.data ?? []) purchased.add(row.photo_id as string);
  return [...purchased];
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
