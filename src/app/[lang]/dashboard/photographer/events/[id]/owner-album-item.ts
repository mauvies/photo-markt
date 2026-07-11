import type { UploaderProfileMap } from '@/app/[lang]/events/[shareCode]/photo-album-item';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import type { PhotoDetail } from '@/database/queries/photos';
import { thumbRelativeUrl } from '@/lib/thumbnails';

type PhotoTag = NonNullable<PhotoAlbumItem['tags']>[number];

/**
 * Owner-side uploader attribution — like the public builder but exposes the
 * guest email (only the event owner may see it) and never falls back to the
 * event owner (the photographer's own uploads simply get no badge here).
 */
function buildOwnerUploader(
  photo: PhotoDetail,
  uploaderProfiles: UploaderProfileMap,
): PhotoUploaderInfo | undefined {
  if (photo.uploaded_by) {
    const profile = uploaderProfiles[photo.uploaded_by];
    const name = profile?.display_name ?? profile?.username ?? photo.guest_name ?? '';
    return name ? { name, isAuthenticated: true } : undefined;
  }
  if (photo.guest_name) {
    return { name: photo.guest_name, email: photo.guest_email ?? null, isAuthenticated: false };
  }
  return undefined;
}

/**
 * Build one owner-dashboard gallery item from a `PhotoDetail` row and its
 * signed ORIGINAL url. Returns `null` when the photo has no signed URL. Shared
 * by the photographer event page's first-batch render and its load-more Server
 * Action so both produce the exact same tile shape (alt = storage path, talent
 * tags, uploader-with-email).
 *
 * Source selection depends on `watermarkEnabled`:
 * - **Watermark off:** the grid renders `thumbMedium ?? url`, so — mirroring the
 *   public builder — we emit the immutable `/api/thumb` URLs when the thumbnail
 *   is baked. Those thumbnails carry no watermark here, and the optimizer skips
 *   them, so they're the cheap, correct source. `thumb_version` busts the CDN
 *   cache when a thumbnail is re-baked with face blur (T-078).
 * - **Watermark on:** the baked thumbnail is watermarked (generate-photo-
 *   thumbnails applies `addWatermarkToImage` before resizing) and is a role-
 *   agnostic content-addressed artifact — there is no un-watermarked variant.
 *   The owner must see their real, un-watermarked material, so we omit the thumb
 *   and let the grid/lightbox fall back to the signed original (`url`). That
 *   original is multi-MB, so we flag it `unoptimized` to keep it out of the
 *   Next.js image optimizer, which timed out fetching large files — the very
 *   reason the thumb path was introduced (T-110).
 */
export function buildOwnerPhotoAlbumItem(
  photo: PhotoDetail,
  opts: {
    signed: Record<string, string>;
    uploaderProfiles: UploaderProfileMap;
    tags: Record<string, PhotoTag[]>;
    watermarkEnabled: boolean;
  },
): PhotoAlbumItem | null {
  const url = photo.original_url ? opts.signed[photo.original_url] : null;
  if (!url) return null;

  const thumbsReady =
    !opts.watermarkEnabled && photo.thumbnail_status === 'ready' && Boolean(photo.original_url);
  const thumbVersion = photo.thumb_version ?? undefined;

  return {
    id: photo.id,
    url,
    // The signed original must skip the optimizer; the /api/thumb URLs already
    // do via `shouldSkipImageOptimization`, so only flag the watermark-off→on
    // fallback path here.
    unoptimized: opts.watermarkEnabled || undefined,
    thumbSmall:
      thumbsReady && photo.original_url
        ? thumbRelativeUrl(photo.original_url, 'small', thumbVersion)
        : undefined,
    thumbMedium:
      thumbsReady && photo.original_url
        ? thumbRelativeUrl(photo.original_url, 'medium', thumbVersion)
        : undefined,
    ...(photo.original_url && { alt: photo.original_url }),
    tags: opts.tags[photo.id] || [],
    uploader: buildOwnerUploader(photo, opts.uploaderProfiles),
    width: photo.width ?? undefined,
    height: photo.height ?? undefined,
  };
}
