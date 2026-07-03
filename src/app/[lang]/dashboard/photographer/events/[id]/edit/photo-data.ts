import { createSignedUrls, getEventPhotos } from '@/database/queries';
import type { SupabaseServerClient } from '@/database/queries/types';
import type { PhotoWithUrl } from './edit-event-schema';

type PhotoRow = { id: string; original_url: string | null };

/**
 * Map photo rows to the edit grid's `PhotoWithUrl` shape, resolving each
 * `original_url` to its signed URL. `url` is `null` only when the row has no
 * `original_url` or no signed URL was minted for it — the grid renders its
 * "no preview" fallback for that genuine case.
 *
 * Pure: no I/O, so the mapping (including the fallback) is unit-testable.
 */
export function toDisplayPhotos(
  photos: PhotoRow[],
  signedUrls: Record<string, string>,
): PhotoWithUrl[] {
  return photos.map((photo) => ({
    id: photo.id,
    url: photo.original_url ? (signedUrls[photo.original_url] ?? null) : null,
    original_url: photo.original_url,
  }));
}

/**
 * Fetch an event's photos for the edit grid and sign their original paths.
 *
 * IMPORTANT: pass the **service-role** client. The `photos` bucket is private
 * with no storage RLS grant for `authenticated`, so signing with a user-scoped
 * client returns null URLs and the grid shows "No preview" for every photo
 * (T-063). Every other photo view signs with `supabaseAdmin` for the same
 * reason. Caller must have already verified event ownership.
 */
export async function getEditEventPhotos(
  adminClient: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<PhotoWithUrl[]> {
  const photos = await getEventPhotos(adminClient, eventId, userId);

  const paths = photos.map((p) => p.original_url).filter((url): url is string => url !== null);

  const signedUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const signed = await createSignedUrls(adminClient, 'photos', paths, 60 * 60);
    for (const item of signed) {
      if (item.signedUrl) signedUrls[item.path] = item.signedUrl;
    }
  }

  return toDisplayPhotos(photos, signedUrls);
}
