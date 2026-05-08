/**
 * Photo-related database queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export type UploadStatus = 'approved' | 'pending';

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
  created_at?: string;
}

export interface PhotoSummary {
  event_id: string | null;
  original_url: string | null;
  taken_at: string | null;
  upload_status?: UploadStatus;
}

export interface PhotoDetail {
  id: string;
  original_url: string | null;
  taken_at: string | null;
  city: string | null;
  country: string | null;
  state: string | null;
  uploaded_by?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  upload_status?: UploadStatus;
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
    .select('event_id, original_url, taken_at')
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
  options?: { status?: UploadStatus; skipUserIdFilter?: boolean },
): Promise<PhotoDetail[]> {
  const status = options?.status ?? 'approved';
  let query = supabase
    .from('photos')
    .select(
      'id, original_url, taken_at, city, country, uploaded_by, guest_name, guest_email, upload_status',
    )
    .eq('event_id', eventId)
    .eq('upload_status', status);
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
    .select('id, original_url, taken_at, city, country, uploaded_by, guest_name')
    .eq('event_id', eventId)
    .eq('upload_status', 'approved')
    .order('taken_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get event photos: ${getErrorMessage(error)}`);
  }

  return (data ?? []) as PhotoDetail[];
}

/**
 * Get photo storage paths for an event
 */
export async function getPhotoStoragePaths(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('original_url')
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to get photo storage paths: ${getErrorMessage(error)}`);
  }

  return (data ?? [])
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
 * Create a photo record
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
  },
): Promise<void> {
  const { error } = await supabase.from('photos').insert({
    user_id: userId,
    ...photoData,
  });

  if (error) {
    throw new Error(`Failed to create photo: ${getErrorMessage(error)}`);
  }
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
 * Delete all photos for an event
 */
export async function deleteEventPhotos(
  supabase: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete event photos: ${getErrorMessage(error)}`);
  }
}
