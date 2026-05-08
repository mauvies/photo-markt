'use server';

import { Buffer } from 'node:buffer';
import { revalidatePath, revalidateTag } from 'next/cache';
import {
  deletePhoto,
  deleteStorageFiles,
  getEventByShareCode,
  getPhotoForContributorDelete,
  type SupabaseServerClient,
  uploadFile,
  uploadGuestPhoto,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { isCollaborativeUploadOpen } from '@/lib/event-status';

const MAX_GUEST_NAME_LENGTH = 60;
const MAX_GUEST_EMAIL_LENGTH = 120;
const ACCEPTED_MIME_PREFIXES = ['image/'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildCollaborativePhotoPath(eventId: string, file: File): string {
  const fileId = crypto.randomUUID();
  const extension = file.name.split('.').pop();
  const safeName = extension ? `${fileId}.${extension.toLowerCase()}` : fileId;
  return `collaborative/${eventId}/${safeName}`;
}

export type UploadGuestPhotosResult = {
  uploadedCount: number;
  status: 'approved' | 'pending';
  /**
   * Per-photo delete tokens. Authenticated contributors can delete via their
   * `uploaded_by` match server-side and don't strictly need these, but we
   * return them anyway for symmetry — the client only persists tokens for
   * unauthenticated guests.
   */
  uploads: Array<{ photoId: string; deleteToken: string | null }>;
};

export async function uploadGuestPhotosAction(
  formData: FormData,
): Promise<UploadGuestPhotosResult> {
  const shareCode = formData.get('share_code')?.toString().trim();
  if (!shareCode) {
    throw new Error('Missing share code.');
  }

  // Re-validate the event server-side: the client's view could be stale and
  // the event may have been flipped non-collaborative since the page loaded.
  const adminClient = supabaseAdmin as unknown as SupabaseServerClient;
  const event = await getEventByShareCode(adminClient, shareCode);
  if (!event || !event.is_collaborative || !event.allow_guest_upload) {
    throw new Error('This event is not accepting contributions.');
  }
  // Block uploads before the event day. Without this, contributed photos
  // pile up in storage while the public gallery still shows "coming soon"
  // and confuses everyone (including the owner).
  if (!isCollaborativeUploadOpen(event.date)) {
    throw new Error('Uploads open on the day of the event.');
  }

  const files = formData
    .getAll('photos')
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) {
    throw new Error('Add at least one photo to continue.');
  }
  for (const file of files) {
    if (!ACCEPTED_MIME_PREFIXES.some((p) => file.type.startsWith(p))) {
      throw new Error('Only image files are accepted.');
    }
  }

  // Identify the uploader. Authenticated users get tracked by uploaded_by;
  // guests submit a display name (required) and optionally an email.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let guestName: string | null = null;
  let guestEmail: string | null = null;
  if (!user) {
    const rawName = formData.get('guest_name')?.toString().trim() ?? '';
    if (!rawName) {
      throw new Error('Please enter your name before uploading.');
    }
    guestName = rawName.slice(0, MAX_GUEST_NAME_LENGTH);

    const rawEmail = formData.get('guest_email')?.toString().trim() ?? '';
    if (rawEmail) {
      if (!EMAIL_REGEX.test(rawEmail) || rawEmail.length > MAX_GUEST_EMAIL_LENGTH) {
        throw new Error('Please enter a valid email address.');
      }
      guestEmail = rawEmail;
    }
  }

  const status: 'approved' | 'pending' = event.require_upload_approval ? 'pending' : 'approved';

  const uploadedPaths: string[] = [];
  const uploads: Array<{ photoId: string; deleteToken: string | null }> = [];
  try {
    for (const file of files) {
      const path = buildCollaborativePhotoPath(event.id, file);
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadFile(adminClient, 'photos', path, buffer, {
        contentType: file.type || undefined,
        upsert: false,
      });
      uploadedPaths.push(path);
      // Mint a fresh per-photo token. Stored both in the DB row and returned
      // to the client so guests can delete their own contributions later.
      const deleteToken = crypto.randomUUID();
      const inserted = await uploadGuestPhoto(adminClient, {
        event_id: event.id,
        owner_user_id: event.user_id,
        uploaded_by: user?.id ?? null,
        guest_name: guestName,
        guest_email: guestEmail,
        original_url: path,
        upload_status: status,
        delete_token: deleteToken,
        taken_at: new Date().toISOString(),
        size_bytes: file.size,
      });
      uploads.push({ photoId: inserted.id, deleteToken: inserted.delete_token });
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await deleteStorageFiles(adminClient, 'photos', uploadedPaths);
      } catch (cleanupError) {
        console.error('Guest upload cleanup failed', cleanupError);
      }
    }
    console.error('Guest upload failed', error);
    throw new Error(error instanceof Error ? error.message : 'Upload failed. Please try again.');
  }

  revalidatePath(`/es/events/${shareCode}`);
  revalidatePath(`/en/events/${shareCode}`);
  revalidatePath(`/es/dashboard/photographer/events/${event.id}`);
  revalidatePath(`/en/dashboard/photographer/events/${event.id}`);
  revalidateTag(`event-${event.id}`, 'max');

  return { uploadedCount: files.length, status, uploads };
}

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

  return { success: true };
}
