'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import {
  createPhotoUrlMap,
  deleteEventPhotosByIds,
  deleteStorageFiles,
  eventExists,
  getEvent,
  getEventPhotoStoragePaths,
  getEventPhotosPage,
  getPhoto,
  getProfilesByIds,
  getTagsForPhotos,
  inviteEventPhotographer,
  isPhotoTaggedForTalent,
  listFailedEventUploads,
  resetEventPhotosForRetry,
  revokeEventPhotographer,
  type SupabaseServerClient,
  searchPhotographers,
  setEventPhotosUploadStatus,
  tagPhotosForTalent,
  untagPhotoForTalent,
} from '@/database/queries';
import {
  type BibDetectionEventStatus,
  getEventBibDetectionProgress,
  getEventBibDetectionState,
} from '@/database/queries/bib-numbers';
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
import { rateLimit } from '@/lib/rate-limit';
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

  // No `email`: the RPC stopped returning it in 20260804000000 (T-226) precisely
  // because this mapping already discarded it.
  return data.map((user: { id: string; display_name: string | null }) => ({
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
    .map((p) =>
      buildOwnerPhotoAlbumItem(p, {
        signed,
        uploaderProfiles,
        tags,
        watermarkEnabled: event.watermark_enabled,
      }),
    )
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
 * Shared auth gate for the approve/reject queue actions: an authenticated
 * photographer must own the event. Returns the owner's user id.
 */
async function requirePendingQueueOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  verb: 'approve' | 'reject',
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(`You must be signed in to ${verb} photos.`);
  }
  if (!(await eventExists(supabase, eventId, user.id))) {
    throw new Error('Event not found or access denied.');
  }
  return user.id;
}

/** Bust every cache surface a queue mutation touches (event detail + listings). */
async function revalidateAfterPendingQueueMutation(
  eventId: string,
  ownerId: string,
): Promise<void> {
  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  await revalidateEventPhotoCacheTags(eventId);
  await revalidateEventListingTags(ownerId);
}

// The moderation queue is read with the service-role client (the page fetches
// it `skipUserIdFilter: true`), so it lists organizer-contributor uploads whose
// `user_id` is the contributor, not the owner. The write path must match: after
// verifying the caller owns the event with the user-scoped client, the bulk ops
// run on `supabaseAdmin`, scoped to `event_id`. A user-scoped write would hit
// RLS `own_photos_mutate (user_id = auth.uid())` and silently skip contributor
// rows (0-row update / null lookup) — the queue could then neither approve nor
// reject them.
const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/**
 * Approve one or more pending photos on a collaborative event in a single bulk
 * write. Single auth check + single cache bust for the whole batch.
 */
export async function approvePendingPhotosAction(
  photoIds: string[],
  eventId: string,
): Promise<{ success: true; count: number }> {
  const supabase = await createClient();
  const ownerId = await requirePendingQueueOwner(supabase, eventId, 'approve');

  await setEventPhotosUploadStatus(adminClient, eventId, photoIds, 'approved');

  await revalidateAfterPendingQueueMutation(eventId, ownerId);
  return { success: true, count: photoIds.length };
}

/**
 * Reject one or more pending photos: hard-delete the `photos` rows and their
 * storage objects in bulk. No undo. Single auth check + single cache bust.
 */
export async function rejectPendingPhotosAction(
  photoIds: string[],
  eventId: string,
): Promise<{ success: true; count: number }> {
  const supabase = await createClient();
  const ownerId = await requirePendingQueueOwner(supabase, eventId, 'reject');

  // Collect the storage paths before the rows are gone. Delete the rows as one
  // statement, then best-effort remove the objects (admin client so guest
  // `collaborative/{event_id}/...` paths aren't blocked by storage RLS).
  const paths = await getEventPhotoStoragePaths(adminClient, eventId, photoIds);
  await deleteEventPhotosByIds(adminClient, eventId, photoIds);
  if (paths.length > 0) {
    await deleteStorageFiles(adminClient, 'photos', paths);
  }

  await revalidateAfterPendingQueueMutation(eventId, ownerId);
  return { success: true, count: photoIds.length };
}

/**
 * Approve a single pending photo. Thin wrapper over the batch action so the
 * two paths never diverge.
 */
export async function approvePendingPhotoAction(
  photoId: string,
  eventId: string,
): Promise<{ success: true }> {
  await approvePendingPhotosAction([photoId], eventId);
  return { success: true };
}

/**
 * Reject a single pending photo (hard delete, no undo). Thin wrapper over the
 * batch action.
 */
export async function rejectPendingPhotoAction(
  photoId: string,
  eventId: string,
): Promise<{ success: true }> {
  await rejectPendingPhotosAction([photoId], eventId);
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
    // Rapid duplicate triggers for this event collapse into one backfill run
    // via the worker's `debounce` config (see backfill-event-indexing.ts).
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
    // Rapid duplicate enables collapse into one backfill via the worker's
    // `debounce` config (see backfill-event-bib-detection.ts).
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
  /** Every non-deleted photo, queued or not — lets the card tell "no photos"
   *  from "photos exist but none are queued" instead of showing "0 of 0"
   *  for both (T-209). */
  totalPhotoCount: number;
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
    totalPhotoCount: progress.totalPhotos,
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
    // A double-click on "Re-index event" is the canonical double-spend path
    // (T-089); the worker's `debounce` collapses the burst into one run.
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

/**
 * Lightweight progress poll for the owner's bib-detection status card — the
 * bib-number counterpart of `getEventIndexingProgress`. Returns a compact
 * payload so the card can refresh "X of Y processed" without a page reload.
 * Owner-only. Read-only: it just surfaces the state the `detectPhotoBibs`
 * worker already persists (no new AWS cost). (T-139)
 */
export interface EventBibProgress {
  status: BibDetectionEventStatus;
  processedCount: number;
  totalCount: number;
  failedCount: number;
  pendingCount: number;
  withBibsCount: number;
}

export async function getEventBibDetectionProgressAction(
  eventId: string,
): Promise<EventBibProgress> {
  const supabase = await createClient();
  await requireEventOwner(supabase, eventId);

  const state = await getEventBibDetectionState(supabase, eventId);
  const progress = await getEventBibDetectionProgress(supabase, eventId);

  return {
    status: state?.status ?? 'idle',
    processedCount: progress.processed,
    totalCount: progress.totalApplicable,
    failedCount: progress.failed,
    pendingCount: progress.pending,
    withBibsCount: progress.withBibs,
  };
}

// ─── Failed uploads: retry / discard (T-231) ─────────────────────────────────
//
// A photo lands in `upload_status='failed'` when the `photo.uploaded` worker
// exhausted its retries before reaching a verdict — the bytes are still in
// Storage but no automatic path will ever pick them up again (the reconcile
// cron deliberately leaves exhausted photos alone; auto-requeuing them is the
// retry storm T-231 removed). Recovery is therefore an explicit owner decision,
// which is also the right shape for the incident that motivated this: once the
// environment mismatch is fixed, one click re-drives every stranded photo.
//
// Both actions use the service-role client scoped to `event_id`, for the same
// reason as the moderation bulk ops above: a contributor upload's `user_id` is
// the contributor, so a user-scoped write would silently skip it.

/** Photos per `inngest.send` call on retry — keeps a large batch under the
 *  request payload limit instead of failing the whole retry as one oversized
 *  send. Each event payload is ~150 B. */
const RETRY_EMIT_CHUNK_SIZE = 500;

/**
 * Re-drive every `failed` upload of an event: reset the pipeline columns and
 * re-emit `photo.uploaded` so the worker redoes download → byte validation →
 * promotion. Deliberately re-runs the real pipeline instead of promoting the
 * rows here — a photo whose bytes were never validated must not go live blind.
 *
 * Rate-limited per owner: each re-emitted photo can trigger billable AWS work
 * (IndexFaces / DetectText), so a stuck-on-refresh retry button must not fan
 * that out without bound.
 */
export async function retryFailedUploadsAction(
  eventId: string,
): Promise<{ success: true; count: number }> {
  const supabase = await createClient();
  const ownerId = await requireEventOwner(supabase, eventId);

  const limit = await rateLimit({
    key: `retry-failed-uploads:${ownerId}`,
    limit: 20,
    windowSec: 60 * 60,
  });
  if (!limit.ok) {
    throw new Error('Too many retries. Please wait a few minutes and try again.');
  }

  const failed = await listFailedEventUploads(adminClient, eventId);
  const retriable = failed.filter(
    (photo): photo is { id: string; storagePath: string } => photo.storagePath !== null,
  );
  if (retriable.length === 0) return { success: true, count: 0 };

  // Reset BEFORE the emit: if the send throws, the rows are already in the
  // state the worker expects and the reconcile cron is allowed to pick them up
  // (their `face_index_status` is no longer `failed`). The reverse order would
  // leave a run racing a row that still reads `failed`.
  await resetEventPhotosForRetry(
    adminClient,
    eventId,
    retriable.map((photo) => photo.id),
  );

  try {
    // Chunked: a whole failed bulk upload can be thousands of photos, and one
    // `send` carrying all of them would push the request past Inngest's payload
    // limit and fail the entire retry rather than part of it.
    for (let i = 0; i < retriable.length; i += RETRY_EMIT_CHUNK_SIZE) {
      await inngest.send(
        retriable.slice(i, i + RETRY_EMIT_CHUNK_SIZE).map((photo) => ({
          name: 'photo.uploaded' as const,
          data: { photoId: photo.id, eventId, storagePath: photo.storagePath },
        })),
      );
    }
  } catch (err) {
    console.error('[retryFailedUploadsAction] failed to enqueue photo.uploaded batch', err);
    throw new Error("Couldn't start the retry. Please try again.");
  }

  await revalidateAfterPendingQueueMutation(eventId, ownerId);
  return { success: true, count: retriable.length };
}

/**
 * Discard every `failed` upload of an event: hard-delete the rows and their
 * storage objects. No undo, and no soft-delete branch — a photo that never
 * reached `approved` cannot have been sold, so the T-142 buyer-retention case
 * doesn't apply. This is also what frees the bytes from the event's photo cap.
 */
export async function discardFailedUploadsAction(
  eventId: string,
): Promise<{ success: true; count: number }> {
  const supabase = await createClient();
  const ownerId = await requireEventOwner(supabase, eventId);

  const failed = await listFailedEventUploads(adminClient, eventId);
  if (failed.length === 0) return { success: true, count: 0 };

  const ids = failed.map((photo) => photo.id);
  const paths = failed
    .map((photo) => photo.storagePath)
    .filter((path): path is string => path !== null);

  await deleteEventPhotosByIds(adminClient, eventId, ids);
  if (paths.length > 0) {
    await deleteStorageFiles(adminClient, 'photos', paths);
  }

  await revalidateAfterPendingQueueMutation(eventId, ownerId);
  return { success: true, count: ids.length };
}
