'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import {
  createPhotoUrlMap,
  deletePhoto,
  deleteStorageFiles,
  eventExists,
  getEvent,
  getEventPhotosPage,
  getPhoto,
  getProfilesByIds,
  getTagsForPhotos,
  inviteEventPhotographer,
  isPhotoTaggedForTalent,
  revokeEventPhotographer,
  type SupabaseServerClient,
  searchPhotographers,
  tagPhotosForTalent,
  untagPhotoForTalent,
  updatePhotoUploadStatus,
} from '@/database/queries';
import { getEventBibDetectionState } from '@/database/queries/bib-numbers';
import {
  type AiMatchingStatus,
  getEventAiIndexingProgress,
  getEventRekognitionState,
} from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { revalidateEventDetailTags, revalidateEventListingTags } from '@/lib/event-cache-tags';
import { EVENT_GALLERY_PAGE_SIZE } from '@/lib/event-gallery';
import { eventUsesModerationQueue } from '@/lib/event-status';
import { inngest } from '@/lib/inngest/client';
import { buildOwnerPhotoAlbumItem } from './owner-album-item';

// Invalidates the `event-${param}` cache tag for every param a viewer might
// have used to reach the event (UUID, slug, or share_code). Without this,
// photo content changes (uploads/approvals/rejections) only invalidate the
// UUID-keyed cache, so visitors arriving via slug or share_code keep seeing
// the stale photo list until the 55-min TTL elapses.
async function revalidateEventPhotoCacheTags(eventId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('events')
    .select('slug, share_code')
    .eq('id', eventId)
    .maybeSingle();
  revalidateEventDetailTags({
    id: eventId,
    slug: data?.slug ?? null,
    share_code: data?.share_code ?? null,
  });
}

export type PhotographerSearchHit = {
  id: string;
  username: string | null;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Server-action wrapper around `searchPhotographers()` so the invite dialog
 * can run typeahead searches without exposing direct DB access to the client.
 */
export async function searchPhotographersAction(query: string): Promise<PhotographerSearchHit[]> {
  if (!query || query.trim().length < 2) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to search photographers.');

  const hits = await searchPhotographers(supabase, query.trim(), 10);
  // Filter the caller out of their own search results — they can't invite
  // themselves to their own event.
  return hits
    .filter((h) => h.id !== user.id)
    .map((h) => ({
      id: h.id,
      username: h.username,
      slug: h.slug,
      display_name: h.display_name,
      avatar_url: h.avatar_url,
    }));
}

/**
 * Invite a photographer to an organizer event. Verifies the caller owns the
 * event and that the target user is not already on the list.
 */
export async function inviteEventPhotographerAction(eventId: string, photographerId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to invite photographers.');

  const event = await getEvent(supabase, eventId, user.id);
  if (!event) throw new Error('Event not found or access denied.');
  if (event.type !== 'organizer') {
    throw new Error('Only organizer events accept photographer invitations.');
  }
  if (photographerId === user.id) {
    throw new Error("You can't invite yourself to your own event.");
  }

  const row = await inviteEventPhotographer(supabase, {
    eventId,
    photographerId,
    organizerId: user.id,
  });

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidateTag(`event-${eventId}`, 'max');
  return row;
}

/**
 * Revoke (hard-delete pending, soft-mark accepted) an event-photographer row.
 * Returns the new status when soft-marked, or null when the row was deleted.
 */
export async function revokeEventPhotographerAction(
  invitationId: string,
  eventId: string,
): Promise<'revoked' | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to revoke photographers.');

  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }

  // Read existing status so we know whether to return 'revoked' or null.
  const { data: existing } = await supabase
    .from('event_photographers')
    .select('status')
    .eq('id', invitationId)
    .eq('event_id', eventId)
    .maybeSingle();

  await revokeEventPhotographer(supabase, {
    invitationId,
    eventId,
    organizerId: user.id,
  });

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  revalidateTag(`event-${eventId}`, 'max');

  return existing?.status === 'pending' ? null : 'revoked';
}

/**
 * Photographer side: respond to a pending invitation by accepting or declining.
 */
export async function respondToEventInvitationAction(
  invitationId: string,
  status: 'accepted' | 'declined',
): Promise<{ status: 'accepted' | 'declined' }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to respond to invitations.');

  const { data, error } = await supabase
    .from('event_photographers')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('photographer_id', user.id)
    .eq('status', 'pending')
    .select('id, event_id')
    .single();

  if (error || !data) {
    throw new Error('Invitation not found or already responded.');
  }

  revalidatePath(`/es/dashboard/photographer/events/${data.event_id}`);
  revalidatePath(`/en/dashboard/photographer/events/${data.event_id}`);
  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  return { status };
}

/**
 * Find users by partial text match (email or display name)
 */
export async function searchTalentUsers(
  searchText: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    username: string;
    display_name: string | null;
  }>
> {
  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    throw new Error('You must be signed in to search for talent.');
  }

  if (!searchText.trim()) {
    return [];
  }

  // Use RPC function to search for users by partial text
  const { data, error } = await supabase.rpc('search_users_by_text', {
    search_text: searchText.trim(),
    result_limit: limit,
  });

  if (error) {
    throw new Error(`Failed to search users: ${error.message}`);
  }

  if (!data) return [];

  // Get usernames from profiles
  const userIds = data.map((user: { id: string }) => user.id);
  const usernameMap: Record<string, string | null> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);

    if (profiles) {
      for (const profile of profiles) {
        usernameMap[profile.id] = profile.username;
      }
    }
  }

  return data.map((user: { id: string; email: string; display_name: string | null }) => ({
    id: user.id,
    username: usernameMap[user.id] ?? 'unknown',
    display_name: user.display_name || null,
  }));
}

/**
 * Find a user by username for tagging (backward compatibility)
 */
export async function findTalentByUsername(username: string): Promise<{
  id: string;
  username: string;
  display_name: string | null;
} | null> {
  const results = await searchTalentUsers(username, 1);
  return results.length > 0 ? results[0] : null;
}

/**
 * Get tags for photos in an event
 */
export async function getPhotoTags(photoIds: string[]): Promise<
  Record<
    string,
    Array<{
      tag_id: string;
      talent_user_id: string;
      talent_username: string;
      talent_display_name: string | null;
      tagged_at: string;
    }>
  >
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to view photo tags.');
  }

  if (photoIds.length === 0) {
    return {};
  }

  return getTagsForPhotos(supabase, photoIds);
}

/**
 * Returns a short-lived signed URL for downloading a photo's ORIGINAL file.
 * The URL carries `Content-Disposition: attachment` so the browser saves it
 * rather than navigating. Verifies the caller owns the event.
 */
export async function getPhotoDownloadUrlAction(photoId: string, eventId: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to download a photo.');

  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }

  const photo = await getPhoto(supabase, photoId, eventId, user.id);
  if (!photo?.original_url) throw new Error('Photo not found.');

  const { data, error } = await supabase.storage
    .from('photos')
    .createSignedUrl(photo.original_url, 300, { download: true });
  if (error || !data?.signedUrl) {
    throw new Error('Could not prepare the download.');
  }
  return data.signedUrl;
}

/**
 * Fetch, sign, tag, and map the next page of an owner's event gallery for the
 * "Load more" button. Owner-only: the full album renders only for the event
 * owner, so ownership is verified via `getEvent`. Signs ORIGINALS (the owner
 * sees un-watermarked photos) and mirrors the page's grid query — including
 * pending photos only when the event doesn't route uploads through the
 * moderation queue.
 */
export async function loadMoreOwnerEventPhotos(
  eventId: string,
  offset: number,
): Promise<{ items: PhotoAlbumItem[]; hasMore: boolean; nextOffset: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const event = await getEvent(supabase, eventId, user.id);
  if (!event) throw new Error('Event not found or access denied.');

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const { photos, hasMore } = await getEventPhotosPage(adminClient, eventId, user.id, {
    skipUserIdFilter: true,
    includePending: !eventUsesModerationQueue(event),
    limit: EVENT_GALLERY_PAGE_SIZE,
    offset,
  });

  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);
  const uploaderUserIds = photos.map((p) => p.uploaded_by).filter((v): v is string => Boolean(v));

  // Signing (originals), tags, and uploader profiles are independent — run them
  // together. Tags use the cookie client (RLS-friendly, matches the page);
  // profiles use the admin client since guest rows sit outside the owner's RLS.
  const [signed, tags, uploaderProfiles] = await Promise.all([
    createPhotoUrlMap(adminClient, 'photos', paths, { expiresIn: 60 * 60 }),
    getTagsForPhotos(
      supabase,
      photos.map((p) => p.id),
    ),
    getProfilesByIds(adminClient, uploaderUserIds),
  ]);

  const items = photos
    .map((p) => buildOwnerPhotoAlbumItem(p, { signed, uploaderProfiles, tags }))
    .filter((item): item is PhotoAlbumItem => item !== null);

  return { items, hasMore, nextOffset: offset + photos.length };
}

/**
 * Tag multiple photos for a talent user
 */
export async function tagPhotosForTalentAction(
  photoIds: string[],
  talentUserId: string,
): Promise<{ success: boolean; taggedCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to tag photos.');
  }

  if (photoIds.length === 0) {
    return { success: false, taggedCount: 0 };
  }

  // Verify all photos belong to the current user
  // We'll check ownership via a query that ensures user_id matches
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('id')
    .in('id', photoIds)
    .eq('user_id', user.id);

  if (photosError || !photos || photos.length !== photoIds.length) {
    throw new Error("One or more photos not found or you don't have permission.");
  }

  const taggedCount = await tagPhotosForTalent(supabase, photoIds, talentUserId, user.id);

  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${photoIds[0]}`); // Revalidate event page
  revalidatePath(`/en/dashboard/photographer/events/${photoIds[0]}`); // Revalidate event page

  return { success: true, taggedCount };
}

/**
 * Untag a photo for a talent user
 */
export async function untagPhotoForTalentAction(
  photoId: string,
  talentUserId: string,
): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to untag photos.');
  }

  // Verify photo belongs to the current user
  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .eq('user_id', user.id)
    .single();

  if (photoError || !photo) {
    throw new Error("Photo not found or you don't have permission.");
  }

  await untagPhotoForTalent(supabase, photoId, talentUserId);

  revalidatePath('/es/dashboard/photographer/events');
  revalidatePath('/en/dashboard/photographer/events');
  revalidatePath(`/es/dashboard/photographer/events/${photoId}`);
  revalidatePath(`/en/dashboard/photographer/events/${photoId}`);

  return { success: true };
}

/**
 * Check if a photo is tagged for a talent user
 */
export async function checkPhotoTaggedForTalent(
  photoId: string,
  talentUserId: string,
): Promise<boolean> {
  const supabase = await createClient();
  return await isPhotoTaggedForTalent(supabase, photoId, talentUserId);
}

/**
 * Approve a pending guest-uploaded photo on a collaborative event.
 */
export async function approvePendingPhotoAction(
  photoId: string,
  eventId: string,
): Promise<{ success: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to approve photos.');
  }
  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }

  await updatePhotoUploadStatus(supabase, {
    photoId,
    eventId,
    status: 'approved',
  });

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  await revalidateEventPhotoCacheTags(eventId);
  await revalidateEventListingTags(user.id);
  return { success: true };
}

/**
 * Reject a pending guest-uploaded photo: hard-delete the storage object and
 * the photos row. No undo.
 */
export async function rejectPendingPhotoAction(
  photoId: string,
  eventId: string,
): Promise<{ success: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to reject photos.');
  }
  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }

  const photo = await getPhoto(supabase, photoId, eventId, user.id);
  if (!photo) throw new Error('Photo not found.');

  await deletePhoto(supabase, photoId, user.id);
  if (photo.original_url) {
    await deleteStorageFiles(supabase, 'photos', [photo.original_url]);
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  await revalidateEventPhotoCacheTags(eventId);
  await revalidateEventListingTags(user.id);
  return { success: true };
}

// ─── AI matching toggle + re-index ────────────────────────────────────────────

/**
 * Auth gate shared by the three AI server actions. Verifies an authenticated
 * photographer owns the event. Returns the user id on success.
 */
async function requireEventOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  const event = await getEvent(supabase, eventId, user.id);
  if (!event) throw new Error('Event not found.');
  return user.id;
}

/**
 * Enable AWS Rekognition face matching on an event. Rejected for events
 * flagged as containing minors. The Inngest backfill worker handles the
 * actual collection creation + initial indexing of existing photos.
 */
export async function enableAIMatchingForEvent(eventId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const userId = await requireEventOwner(supabase, eventId);

  const state = await getEventRekognitionState(supabase, eventId);
  if (!state) throw new Error('Event not found.');
  if (state.containsMinors) {
    throw new Error("AI matching can't be enabled on events that contain minors.");
  }

  await supabase
    .from('events')
    .update({ ai_matching_enabled: true })
    .eq('id', eventId)
    .eq('user_id', userId);

  try {
    await inngest.send({
      name: 'event.ai-matching-enabled',
      data: { eventId, userId },
    });
  } catch (err) {
    console.error('[enableAIMatchingForEvent] failed to enqueue', err);
    throw new Error("Couldn't enable AI matching. Please try again.");
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  return { success: true };
}

/** Disable AWS Rekognition face matching. The worker tears down the
 * per-event collection and clears `photo_faces`. */
export async function disableAIMatchingForEvent(eventId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const userId = await requireEventOwner(supabase, eventId);

  await supabase
    .from('events')
    .update({ ai_matching_enabled: false })
    .eq('id', eventId)
    .eq('user_id', userId);

  try {
    await inngest.send({
      name: 'event.ai-matching-disabled',
      data: { eventId },
    });
  } catch (err) {
    console.error('[disableAIMatchingForEvent] failed to enqueue', err);
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  return { success: true };
}

/**
 * Opt an event into BIB-number detection. Owner-only. Enabling fires the
 * backfill worker over existing photos; new uploads are picked up by the
 * per-photo worker. Mirrors enableAIMatchingForEvent. (T-032)
 */
export async function enableBibDetectionForEvent(eventId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const userId = await requireEventOwner(supabase, eventId);

  const state = await getEventBibDetectionState(supabase, eventId);
  if (!state) throw new Error('Event not found.');
  if (state.containsMinors) {
    throw new Error("Bib detection can't be enabled on events that contain minors.");
  }

  await supabase
    .from('events')
    .update({ bib_detection_enabled: true })
    .eq('id', eventId)
    .eq('user_id', userId);

  try {
    await inngest.send({
      name: 'event.bib-detection-enabled',
      data: { eventId, userId },
    });
  } catch (err) {
    console.error('[enableBibDetectionForEvent] failed to enqueue', err);
    throw new Error("Couldn't enable bib detection. Please try again.");
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  // Bust the public / talent event caches (keyed by UUID, slug, or share_code)
  // so the bib search bar appears immediately instead of after the 55-min TTL.
  await revalidateEventPhotoCacheTags(eventId);
  return { success: true };
}

/**
 * Disable BIB detection. Existing detected bibs are kept (re-enabling is then
 * instant); detection and talent search just stop. Owner-only. (T-032)
 */
export async function disableBibDetectionForEvent(eventId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const userId = await requireEventOwner(supabase, eventId);

  await supabase
    .from('events')
    .update({ bib_detection_enabled: false })
    .eq('id', eventId)
    .eq('user_id', userId);

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  // Bust the public / talent event caches so the bib search bar disappears
  // immediately instead of lingering until the 55-min TTL.
  await revalidateEventPhotoCacheTags(eventId);
  return { success: true };
}

/**
 * Lightweight progress poll for the owner's AI-status card. Returns a
 * compact JSON payload so the client can refresh "X of Y indexed" without
 * a full page reload. Owner-only — uses `requireEventOwner` for auth.
 *
 * Calling cadence is owned by the caller (`AiStatusCard` polls every 5s
 * while the event is in `idle`-with-pending or `indexing` state). The
 * helper is otherwise stateless.
 */
export interface EventIndexingProgress {
  status: AiMatchingStatus;
  indexedCount: number;
  totalCount: number;
  failedCount: number;
  pendingCount: number;
  lastIndexedAt: string | null;
}

export async function getEventIndexingProgress(eventId: string): Promise<EventIndexingProgress> {
  const supabase = await createClient();
  await requireEventOwner(supabase, eventId);

  const state = await getEventRekognitionState(supabase, eventId);
  const progress = await getEventAiIndexingProgress(supabase, eventId);

  return {
    status: state?.status ?? 'idle',
    indexedCount: progress.indexed,
    totalCount: progress.totalApplicable,
    failedCount: progress.failed,
    pendingCount: progress.pending,
    lastIndexedAt: progress.lastIndexedAt,
  };
}

/** Re-run indexing across an event's photos. Reuses the backfill worker
 * which resets failed photos and re-enqueues them. */
export async function reindexEvent(eventId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const userId = await requireEventOwner(supabase, eventId);

  const state = await getEventRekognitionState(supabase, eventId);
  if (!state?.enabled) {
    throw new Error('AI matching must be enabled before re-indexing.');
  }

  try {
    await inngest.send({
      name: 'event.ai-matching-enabled',
      data: { eventId, userId },
    });
  } catch (err) {
    console.error('[reindexEvent] failed to enqueue', err);
    throw new Error("Couldn't start re-indexing. Please try again.");
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  return { success: true };
}
