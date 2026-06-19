/**
 * Talent photo tag-related database queries
 */

import type { SupabaseServerClient } from './types';
import { getErrorMessage } from './types';

export interface TalentPhotoTag {
  id: string;
  photo_id: string;
  talent_user_id: string;
  tagged_by_user_id: string;
  created_at: string;
}

export interface TaggedPhotoWithEvent {
  photo_id: string;
  photo_url: string | null;
  taken_at: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_city: string | null;
  event_country: string | null;
  event_watermark_enabled: boolean | null;
  tagged_at: string;
}

export interface PhotoTagInfo {
  tag_id: string;
  talent_user_id: string;
  talent_username: string;
  talent_display_name: string | null;
  tagged_at: string;
}

/**
 * Tag a photo for a talent user
 */
export async function tagPhotoForTalent(
  supabase: SupabaseServerClient,
  photoId: string,
  talentUserId: string,
  taggedByUserId: string,
): Promise<void> {
  const { error } = await supabase.from('talent_photo_tags').insert({
    photo_id: photoId,
    talent_user_id: talentUserId,
    tagged_by_user_id: taggedByUserId,
  });

  if (error) {
    // Handle duplicate tag gracefully
    if (error.code === '23505') {
      // Unique constraint violation - tag already exists
      return;
    }
    throw new Error(`Failed to tag photo for talent: ${getErrorMessage(error)}`);
  }
}

/**
 * Tag multiple photos for a talent user
 */
export async function tagPhotosForTalent(
  supabase: SupabaseServerClient,
  photoIds: string[],
  talentUserId: string,
  taggedByUserId: string,
): Promise<number> {
  if (photoIds.length === 0) {
    return 0;
  }

  // Use upsert to handle duplicates gracefully
  const { data, error } = await supabase
    .from('talent_photo_tags')
    .upsert(
      photoIds.map((photoId) => ({
        photo_id: photoId,
        talent_user_id: talentUserId,
        tagged_by_user_id: taggedByUserId,
      })),
      {
        onConflict: 'photo_id,talent_user_id',
        ignoreDuplicates: true,
      },
    )
    .select();

  if (error) {
    throw new Error(`Failed to tag photos for talent: ${getErrorMessage(error)}`);
  }

  return data?.length ?? 0;
}

/**
 * Untag a photo for a talent user
 */
export async function untagPhotoForTalent(
  supabase: SupabaseServerClient,
  photoId: string,
  talentUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from('talent_photo_tags')
    .delete()
    .eq('photo_id', photoId)
    .eq('talent_user_id', talentUserId);

  if (error) {
    throw new Error(`Failed to untag photo for talent: ${getErrorMessage(error)}`);
  }
}

/**
 * Untag multiple photos for a talent user in a single query
 */
export async function untagPhotosForTalent(
  supabase: SupabaseServerClient,
  photoIds: string[],
  talentUserId: string,
): Promise<void> {
  if (photoIds.length === 0) return;
  const { error } = await supabase
    .from('talent_photo_tags')
    .delete()
    .in('photo_id', photoIds)
    .eq('talent_user_id', talentUserId);
  if (error) {
    throw new Error(`Failed to untag photos for talent: ${getErrorMessage(error)}`);
  }
}

/**
 * Check if a photo is tagged for a talent user
 */
export async function isPhotoTaggedForTalent(
  supabase: SupabaseServerClient,
  photoId: string,
  talentUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('talent_photo_tags')
    .select('id')
    .eq('photo_id', photoId)
    .eq('talent_user_id', talentUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check photo tag: ${getErrorMessage(error)}`);
  }

  return data !== null;
}

/**
 * Get all photos tagged for a talent user, grouped by event and date
 */
export async function getTaggedPhotosForTalent(
  supabase: SupabaseServerClient,
  talentUserId: string,
  options?: {
    limit?: number;
    offset?: number;
  },
): Promise<TaggedPhotoWithEvent[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const { data, error } = await supabase
    .from('talent_photo_tags')
    .select(
      `
      photo_id,
      created_at,
      photos!inner(
        id,
        original_url,
        taken_at,
        event_id,
        events(
          id,
          name,
          date,
          city,
          country,
          watermark_enabled
        )
      )
    `,
    )
    .eq('talent_user_id', talentUserId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to get tagged photos for talent: ${getErrorMessage(error)}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: explanation
  return (data ?? []).map((item: any) => {
    const photo = item.photos;
    // Events might be an array or single object depending on Supabase version
    const event = Array.isArray(photo?.events)
      ? photo.events.length > 0
        ? photo.events[0]
        : null
      : photo?.events;
    return {
      photo_id: item.photo_id,
      photo_url: photo?.original_url ?? null,
      taken_at: photo?.taken_at ?? null,
      event_id: event?.id ?? photo?.event_id ?? null,
      event_name: event?.name ?? null,
      event_date: event?.date ?? null,
      event_city: event?.city ?? null,
      event_country: event?.country ?? null,
      event_watermark_enabled: event?.watermark_enabled ?? null,
      tagged_at: item.created_at,
    };
  }) as TaggedPhotoWithEvent[];
}

/**
 * Get count of tagged photos for a talent user
 */
export async function getTaggedPhotosCountForTalent(
  supabase: SupabaseServerClient,
  talentUserId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('talent_photo_tags')
    .select('*', { count: 'exact', head: true })
    .eq('talent_user_id', talentUserId);

  if (error) {
    throw new Error(`Failed to get tagged photos count: ${getErrorMessage(error)}`);
  }

  return count ?? 0;
}

/**
 * Get all tags for multiple photos
 */
export async function getTagsForPhotos(
  supabase: SupabaseServerClient,
  photoIds: string[],
): Promise<Record<string, PhotoTagInfo[]>> {
  if (photoIds.length === 0) {
    return {};
  }

  // First, get all tags
  const { data, error } = await supabase
    .from('talent_photo_tags')
    .select('id, photo_id, talent_user_id, created_at')
    .in('photo_id', photoIds);

  if (error) {
    throw new Error(`Failed to get tags for photos: ${getErrorMessage(error)}`);
  }

  // Get unique talent user IDs
  const talentUserIds = [
    ...new Set((data ?? []).map((tag: { talent_user_id: string }) => tag.talent_user_id)),
  ];

  // Fetch profiles for all talent users
  const profilesMap: Record<string, { display_name: string | null; username: string | null }> = {};
  if (talentUserIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', talentUserIds);

    if (!profilesError && profiles) {
      for (const profile of profiles) {
        profilesMap[profile.id] = {
          display_name: profile.display_name,
          username: profile.username,
        };
      }
    }
  }

  // Structure tags by photo
  const tagsByPhoto: Record<string, PhotoTagInfo[]> = {};

  for (const tag of data ?? []) {
    const photoId = tag.photo_id;
    if (!tagsByPhoto[photoId]) {
      tagsByPhoto[photoId] = [];
    }

    const profile = profilesMap[tag.talent_user_id];

    tagsByPhoto[photoId].push({
      tag_id: tag.id,
      talent_user_id: tag.talent_user_id,
      talent_username: profile?.username ?? 'unknown',
      talent_display_name: profile?.display_name ?? null,
      tagged_at: tag.created_at,
    });
  }

  return tagsByPhoto;
}
