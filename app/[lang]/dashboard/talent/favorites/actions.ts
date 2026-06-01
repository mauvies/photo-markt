'use server';

import {
  createPhotoUrls,
  getTaggedPhotosCountForTalent,
  getTaggedPhotosForTalent,
  isPhotoInCart,
  untagPhotosForTalent,
} from '@/database/queries';
import { createClient } from '@/database/server';
import { getBaseUrl } from '@/lib/get-base-url';

// --- Types ---

export interface TaggedPhotoGroup {
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_city: string | null;
  event_country: string | null;
  event_watermark_enabled: boolean | null;
  dates: Array<{
    date: string;
    photos: Array<{
      photo_id: string;
      photo_url: string;
      signed_url: string | null;
      taken_at: string | null;
      tagged_at: string;
    }>;
  }>;
}

export interface ListMyTaggedPhotosResult {
  groups: TaggedPhotoGroup[];
  totalCount: number;
  hasMore: boolean;
  photosInCart: string[];
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type TaggedPhoto = Awaited<ReturnType<typeof getTaggedPhotosForTalent>>[number];

// --- Helpers ---

async function buildSignedUrlsMap(
  supabase: SupabaseClient,
  photos: TaggedPhoto[],
): Promise<Record<string, string | null>> {
  const photoPaths = photos.map((p) => p.photo_url).filter((url): url is string => url !== null);
  if (photoPaths.length === 0) return {};

  const byWatermark = new Map<boolean, string[]>();
  for (const photo of photos) {
    if (!photo.photo_url) continue;
    const needsWatermark = photo.event_watermark_enabled === true;
    const existing = byWatermark.get(needsWatermark) ?? [];
    existing.push(photo.photo_url);
    byWatermark.set(needsWatermark, existing);
  }

  const baseUrl = await getBaseUrl();
  const signedUrlsMap: Record<string, string | null> = {};

  for (const [needsWatermark, paths] of byWatermark.entries()) {
    const photoUrls = await createPhotoUrls(supabase, 'photos', paths, {
      expiresIn: 3600,
      useWatermark: needsWatermark,
      baseUrl,
    });
    for (const item of photoUrls) {
      signedUrlsMap[item.path] = item.signedUrl;
    }
  }

  return signedUrlsMap;
}

function groupPhotosByEvent(
  photos: TaggedPhoto[],
  signedUrlsMap: Record<string, string | null>,
): TaggedPhotoGroup[] {
  const groupsMap = new Map<string, TaggedPhotoGroup>();

  for (const photo of photos) {
    const eventKey = photo.event_id ?? 'no-event';

    if (!groupsMap.has(eventKey)) {
      groupsMap.set(eventKey, {
        event_id: photo.event_id,
        event_name: photo.event_name ?? 'Uncategorized',
        event_date: photo.event_date ?? null,
        event_city: photo.event_city ?? null,
        event_country: photo.event_country ?? null,
        event_watermark_enabled: photo.event_watermark_enabled ?? null,
        dates: [],
      });
    }

    const group = groupsMap.get(eventKey)!;
    const photoDate = photo.taken_at
      ? new Date(photo.taken_at).toISOString().split('T')[0]
      : 'unknown';

    let dateGroup = group.dates.find((d) => d.date === photoDate);
    if (!dateGroup) {
      dateGroup = { date: photoDate, photos: [] };
      group.dates.push(dateGroup);
    }

    dateGroup.photos.push({
      photo_id: photo.photo_id,
      photo_url: photo.photo_url ?? '',
      signed_url: photo.photo_url ? (signedUrlsMap[photo.photo_url] ?? null) : null,
      taken_at: photo.taken_at,
      tagged_at: photo.tagged_at,
    });
  }

  for (const group of groupsMap.values()) {
    group.dates.sort((a, b) => b.date.localeCompare(a.date));
    for (const dateGroup of group.dates) {
      dateGroup.photos.sort(
        (a, b) => new Date(b.tagged_at).getTime() - new Date(a.tagged_at).getTime(),
      );
    }
  }

  return Array.from(groupsMap.values()).sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0;
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
  });
}

async function getPhotosInCart(
  supabase: SupabaseClient,
  userId: string,
  photoIds: string[],
): Promise<string[]> {
  const inCart: string[] = [];
  for (const photoId of photoIds) {
    if (await isPhotoInCart(supabase, userId, photoId)) {
      inCart.push(photoId);
    }
  }
  return inCart;
}

// --- Exports ---

/**
 * List photos where the current talent user is tagged, grouped by event and date.
 */
export async function listMyTaggedPhotos(options?: {
  limit?: number;
  offset?: number;
}): Promise<ListMyTaggedPhotosResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to view your tagged photos.');
  }

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const [taggedPhotos, totalCount] = await Promise.all([
    getTaggedPhotosForTalent(supabase, user.id, { limit, offset }),
    getTaggedPhotosCountForTalent(supabase, user.id),
  ]);

  const [signedUrlsMap, photosInCart] = await Promise.all([
    buildSignedUrlsMap(supabase, taggedPhotos),
    getPhotosInCart(
      supabase,
      user.id,
      taggedPhotos.map((p) => p.photo_id),
    ),
  ]);

  const groups = groupPhotosByEvent(taggedPhotos, signedUrlsMap);

  return {
    groups,
    totalCount,
    hasMore: offset + taggedPhotos.length < totalCount,
    photosInCart,
  };
}

/**
 * Remove multiple photos from the current user's "My Photos" collection.
 * Does not delete the underlying photo files.
 */
export async function removePhotosFromMyPhotosAction(photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  await untagPhotosForTalent(supabase, photoIds, user.id);
}
