'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import {
  createPhoto,
  deletePhoto,
  deleteStorageFiles,
  eventExists,
  getEvent,
  getPhoto,
  getTagsForPhotos,
  inviteEventPhotographer,
  isApprovedEventPhotographer,
  isPhotoTaggedForTalent,
  revokeEventPhotographer,
  searchPhotographers,
  tagPhotosForTalent,
  untagPhotoForTalent,
  updatePhotoUploadStatus,
  uploadFile,
} from '@/database/queries';
import { getStorageUsageBytes } from '@/database/queries/photos';
import {
  getEventRekognitionState,
  updatePhotoFaceIndexStatus,
} from '@/database/queries/rekognition';
import { createClient } from '@/database/server';
import { inngest } from '@/lib/inngest/client';
import { validatePhotoUpload } from '@/lib/photo-upload';
import { assertCanUploadPhoto, isPlanLimitError } from '@/lib/plan-limits';

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
  revalidateTag(`event-${eventId}`, 'max');
  if (data?.slug) revalidateTag(`event-${data.slug}`, 'max');
  if (data?.share_code) revalidateTag(`event-${data.share_code}`, 'max');
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
 * Upload one or more photos to an organizer event as an accepted photographer.
 * The contributor's own user_id is set on the resulting `photos` rows so they
 * own their submissions (and any future revenue routing flows to them).
 */
export type UploadSkippedReason = 'storage_limit';

export interface UploadResult {
  uploaded: number;
  skipped: Array<{ name: string; reason: UploadSkippedReason }>;
}

export async function uploadOrganizerEventPhotoAction(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to upload photos.');

  const eventId = formData.get('event_id')?.toString();
  if (!eventId) throw new Error('Missing event id.');

  // Look up the event without ownership check — the caller is a contributor,
  // not the owner. We re-read it via a non-owner-scoped query below.
  const { data: event } = await supabase
    .from('events')
    .select('id, type, require_upload_approval, date, city, country, state, deleted_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!event || event.deleted_at) throw new Error('Event not found.');
  if (event.type !== 'organizer') {
    throw new Error('This event does not accept contributor uploads.');
  }

  const isAccepted = await isApprovedEventPhotographer(supabase, {
    eventId,
    photographerId: user.id,
  });
  if (!isAccepted) {
    throw new Error('You are not an accepted photographer for this event.');
  }

  const files = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) throw new Error('No photos provided.');

  const status: 'approved' | 'pending' = event.require_upload_approval ? 'pending' : 'approved';

  // Pre-compute current storage once. We mutate this local total after every
  // successful upload so subsequent files see an accurate running total
  // without re-querying the DB per file. Contributor uploads count against
  // the contributor's own plan — they own the resulting `photos` rows.
  let currentUsage = await getStorageUsageBytes(supabase, user.id);
  // AI matching state is owned by the event organizer; contributor uploads
  // still get indexed into the event's Rekognition collection if enabled.
  const aiState = await getEventRekognitionState(supabase, eventId);
  const shouldIndex = Boolean(aiState?.enabled && !aiState.containsMinors);
  const skipped: UploadResult['skipped'] = [];
  const uploadedPaths: string[] = [];
  let uploaded = 0;

  try {
    for (const file of files) {
      const validated = await validatePhotoUpload(file);
      const fileSize = validated.buffer.length;
      try {
        await assertCanUploadPhoto(supabase, user.id, fileSize, currentUsage);
      } catch (err) {
        if (isPlanLimitError(err)) {
          skipped.push({ name: file.name, reason: 'storage_limit' });
          continue;
        }
        throw err;
      }

      const path = `${user.id}/${eventId}/${crypto.randomUUID()}.${validated.extension}`;
      await uploadFile(supabase, 'photos', path, validated.buffer, {
        contentType: validated.contentType,
        upsert: false,
      });
      uploadedPaths.push(path);
      const inserted = await createPhoto(supabase, user.id, {
        event_id: eventId,
        original_url: path,
        taken_at: new Date(event.date as string).toISOString(),
        city: (event.city as string) || '',
        country: (event.country as string) || '',
        state: (event.state as string | null) ?? null,
        size_bytes: fileSize,
        upload_status: status,
      });
      // Emit `photo.uploaded` so the Inngest worker indexes faces. Failure to
      // enqueue isn't fatal — the photo sits at face_index_status='pending'
      // and a future Re-index can pick it up.
      await emitPhotoUploaded({
        shouldIndex,
        photoId: inserted.id,
        eventId,
        storagePath: path,
        supabase,
      });
      currentUsage += fileSize;
      uploaded += 1;
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await deleteStorageFiles(supabase, 'photos', uploadedPaths).catch(() => {});
    }
    throw error;
  }

  revalidatePath(`/es/dashboard/photographer/events/${eventId}`);
  revalidatePath(`/en/dashboard/photographer/events/${eventId}`);
  await revalidateEventPhotoCacheTags(eventId);
  return { uploaded, skipped };
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
  return { success: true };
}

// ─── AI matching toggle + re-index ────────────────────────────────────────────

/**
 * Helper used by every photographer-side upload path. When the event has AI
 * matching enabled and is not flagged as containing minors, fires a
 * `photo.uploaded` Inngest event so the worker indexes faces. Otherwise marks
 * the photo `not_applicable` directly.
 *
 * Inngest emission failures are logged but never thrown — a transient
 * dispatcher outage shouldn't fail the upload. The photo sits at
 * `face_index_status='pending'` and a future Re-index will pick it up.
 */
async function emitPhotoUploaded(params: {
  shouldIndex: boolean;
  photoId: string;
  eventId: string;
  storagePath: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}): Promise<void> {
  if (!params.shouldIndex) {
    try {
      await updatePhotoFaceIndexStatus(params.supabase, params.photoId, 'not_applicable');
    } catch (err) {
      console.error('[emitPhotoUploaded] failed to mark not_applicable', err);
    }
    return;
  }
  try {
    await inngest.send({
      name: 'photo.uploaded',
      data: {
        photoId: params.photoId,
        eventId: params.eventId,
        storagePath: params.storagePath,
      },
    });
  } catch (err) {
    console.error('[emitPhotoUploaded] failed to enqueue photo.uploaded', err);
  }
}

export { emitPhotoUploaded };

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
