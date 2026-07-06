import type { PhotoAlbumItem } from '@/components/photo-album-viewer';
import type { PhotoUploaderInfo } from '@/components/photo-uploader-indicator';
import type { PhotoDetail } from '@/database/queries/photos';
import { thumbRelativeUrl } from '@/lib/thumbnails';

/** Display-name lookup keyed by profile id, for uploader attribution. */
export type UploaderProfileMap = Record<string, { display_name: string | null; username: string }>;

/** Join the present location parts (city / state / country) into one label,
 * e.g. "Peniche, Portugal". Returns undefined when nothing is set. */
export function formatPhotoLocation(
  city?: string | null,
  state?: string | null,
  country?: string | null,
): string | undefined {
  const parts = [city, state, country].map((p) => p?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** The event fields the public/talent item builder reads. */
export interface AlbumItemEvent {
  user_id: string;
  is_collaborative: boolean;
  name: string;
}

/**
 * A `PhotoAlbumItem` plus the row-ownership fields the PUBLIC viewer needs for
 * client-side "is this mine?" checks (`userId`/`uploadedBy`) and the original
 * storage path. The talent viewer ignores the extra fields; the public viewer
 * reads them for cart/ownership beyond the paginated grid.
 */
export type PublicPhotoAlbumItem = PhotoAlbumItem & {
  userId: string | null;
  uploadedBy: string | null;
  originalPath: string | null;
};

/**
 * Resolve the uploader badge for a public/talent gallery tile, mirroring the
 * attribution rules the event pages used inline:
 *   1. Authenticated contributor (`uploaded_by`) → their profile name.
 *   2. Guest contributor (`guest_name`) → that name, unauthenticated.
 *   3. Collaborative event, no attribution → the event owner (their own upload).
 * Non-collaborative events never populate `uploaded_by`/`guest_name`, so they
 * fall through to no badge.
 */
function buildUploader(
  photo: PhotoDetail,
  event: AlbumItemEvent,
  uploaderProfiles: UploaderProfileMap,
): PhotoUploaderInfo | undefined {
  const uploadedBy = photo.uploaded_by ?? null;
  const guestName = photo.guest_name ?? null;
  if (uploadedBy) {
    const profile = uploaderProfiles[uploadedBy];
    const name = profile?.display_name ?? profile?.username ?? guestName ?? '';
    return name ? { name, isAuthenticated: true } : undefined;
  }
  if (guestName) {
    return { name: guestName, isAuthenticated: false };
  }
  if (event.is_collaborative) {
    const ownerProfile = uploaderProfiles[event.user_id];
    const name = ownerProfile?.display_name ?? ownerProfile?.username ?? '';
    return name ? { name, isAuthenticated: true } : undefined;
  }
  return undefined;
}

/**
 * Build one public/talent gallery item from a `PhotoDetail` row and its signed
 * URL. Returns `null` when the photo has no signed URL (skip it) so callers can
 * `.filter(Boolean)`. Shared by the event pages' first-batch render, the
 * load-more Server Action, and the enriched search results.
 */
export function buildPublicPhotoAlbumItem(
  photo: PhotoDetail,
  opts: {
    signed: Record<string, string>;
    event: AlbumItemEvent;
    uploaderProfiles: UploaderProfileMap;
    alt: string;
  },
): PublicPhotoAlbumItem | null {
  const url = photo.original_url ? opts.signed[photo.original_url] : null;
  if (!url) return null;

  const thumbsReady = photo.thumbnail_status === 'ready';
  return {
    id: photo.id,
    url,
    thumbSmall:
      thumbsReady && photo.original_url ? thumbRelativeUrl(photo.original_url, 'small') : undefined,
    thumbMedium:
      thumbsReady && photo.original_url
        ? thumbRelativeUrl(photo.original_url, 'medium')
        : undefined,
    alt: opts.alt,
    uploader: buildUploader(photo, opts.event, opts.uploaderProfiles),
    width: photo.width ?? undefined,
    height: photo.height ?? undefined,
    location: formatPhotoLocation(photo.city, photo.state, photo.country),
    takenAt: photo.taken_at ?? undefined,
    userId: photo.user_id ?? null,
    uploadedBy: photo.uploaded_by ?? null,
    originalPath: photo.original_url,
  };
}
