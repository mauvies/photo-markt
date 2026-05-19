'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import {
  deletePhoto,
  deleteStorageFiles,
  getEventByShareCode,
  getPhotoForContributorDelete,
  type SupabaseServerClient,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';

/**
 * Delete a photo on a collaborative event from the public viewer.
 *
 * Authorization:
 *   1. Authenticated event owner → always allowed.
 *   2. Authenticated user matching photo.uploaded_by → allowed.
 *   3. Anonymous guest with a matching deleteToken → allowed.
 *   Else → 403-style error.
 *
 * Uses the service-role client because guests have no auth session and the
 * photos RLS only allows owner deletes. Authorization is enforced explicitly
 * in code instead.
 */
export async function deleteContributorPhotoAction(input: {
  photoId: string;
  shareCode: string;
  deleteToken?: string;
}): Promise<{ success: true }> {
  const { photoId, shareCode, deleteToken } = input;
  if (!photoId || !shareCode) {
    throw new Error('Missing photo or event reference.');
  }

  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const event = await getEventByShareCode(adminClient, shareCode);
  if (!event || !event.is_collaborative) {
    throw new Error('Event not found.');
  }

  const photo = await getPhotoForContributorDelete(adminClient, photoId, event.id);
  if (!photo) {
    throw new Error('Photo not found.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isEventOwner = Boolean(user && user.id === photo.event_owner_id);
  const isAuthedUploader = Boolean(user && photo.uploaded_by && user.id === photo.uploaded_by);
  const isGuestUploader = Boolean(
    !user && deleteToken && photo.delete_token && deleteToken === photo.delete_token,
  );

  if (!isEventOwner && !isAuthedUploader && !isGuestUploader) {
    throw new Error('Not authorized to delete this photo.');
  }

  // Delete via admin client. The user_id arg to deletePhoto is just for the
  // RLS-friendly equality clause; we pass the photo's stored user_id so the
  // delete matches even though we're using the service role.
  await deletePhoto(adminClient, photo.id, photo.user_id);
  if (photo.original_url) {
    try {
      await deleteStorageFiles(adminClient, 'photos', [photo.original_url]);
    } catch (cleanupError) {
      console.error('Storage cleanup failed for contributor delete', cleanupError);
    }
  }

  revalidatePath(`/es/events/${shareCode}`);
  revalidatePath(`/en/events/${shareCode}`);
  revalidatePath(`/es/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}`);
  revalidateTag(`event-${event.id}`, 'max');
  if (event.slug) revalidateTag(`event-${event.slug}`, 'max');
  if (event.share_code) revalidateTag(`event-${event.share_code}`, 'max');

  return { success: true };
}
