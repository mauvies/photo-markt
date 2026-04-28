'use server';

import { revalidatePath } from 'next/cache';
import {
  getTagsForPhotos,
  isPhotoTaggedForTalent,
  tagPhotosForTalent,
  untagPhotoForTalent,
} from '@/database/queries';
import { createClient } from '@/database/server';

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
