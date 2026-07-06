import type { UploaderProfileMap } from '@/app/[lang]/events/[shareCode]/photo-album-item';
import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import type { PhotoDetail } from '@/database/queries/photos';

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
 */
export function buildOwnerPhotoAlbumItem(
  photo: PhotoDetail,
  opts: {
    signed: Record<string, string>;
    uploaderProfiles: UploaderProfileMap;
    tags: Record<string, PhotoTag[]>;
  },
): PhotoAlbumItem | null {
  const url = photo.original_url ? opts.signed[photo.original_url] : null;
  if (!url) return null;

  return {
    id: photo.id,
    url,
    ...(photo.original_url && { alt: photo.original_url }),
    tags: opts.tags[photo.id] || [],
    uploader: buildOwnerUploader(photo, opts.uploaderProfiles),
    width: photo.width ?? undefined,
    height: photo.height ?? undefined,
  };
}
