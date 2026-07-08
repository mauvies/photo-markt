import path from 'node:path';
import sharp from 'sharp';

export type ThumbSize = 'small' | 'medium';

const LONGEST_SIDE: Record<ThumbSize, number> = {
  small: 400,
  medium: 800,
};

/**
 * Generate a WebP thumbnail from the given source buffer.
 *
 * Source for paid events (watermark_enabled=true) must already be the
 * watermarked buffer — the caller is responsible for applying
 * addWatermarkToImage() before passing it here. This ensures the stored
 * thumbnail is watermarked and the original is never used as a source.
 */
export async function generateThumbnail(source: Buffer, size: ThumbSize): Promise<Buffer> {
  const longestSide = LONGEST_SIDE[size];
  return sharp(source)
    .rotate() // honour EXIF orientation before resizing
    .resize({ width: longestSide, height: longestSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Derive the storage path for a thumbnail from the original photo's storage
 * path. Strips the extension and inserts a thumbs/{uuid} segment.
 *
 * Example:
 *   originalPath: "uid/eventId/abc123.jpg"
 *   → "uid/eventId/thumbs/abc123/small.webp"
 */
export function thumbStoragePath(originalPath: string, size: ThumbSize): string {
  const ext = path.extname(originalPath);
  const base = ext ? originalPath.slice(0, -ext.length) : originalPath;
  const uuid = path.basename(base);
  const dir = path.dirname(base);
  return `${dir}/thumbs/${uuid}/${size}.webp`;
}

/**
 * Cache-busting query suffix for a thumbnail URL (T-078).
 *
 * Thumbnail objects are content-addressed and served `immutable, max-age=1y`,
 * so a re-bake (face blur applied after AI is enabled post-upload, or a
 * re-index) overwrites the SAME storage path — the CDN/browser would keep
 * serving the stale, unblurred copy for up to a year. `photos.thumb_version`
 * is bumped on every successful bake; appending it as `?v=N` gives the re-baked
 * thumbnail a fresh CDN cache key. Legacy rows (and the first bake before this
 * shipped) sit at version 0 → no suffix → their already-cached URL is untouched,
 * preserving the egress win for photos that never change.
 */
function versionSuffix(version?: number | null): string {
  return version && version > 0 ? `?v=${version}` : '';
}

/**
 * Build the public-facing /api/thumb URL for a stored thumbnail.
 * These are immutable, CDN-cached URLs — no signing required. Pass the photo's
 * `thumb_version` so a re-baked (re-blurred) thumbnail busts the CDN cache.
 */
export function thumbUrl(
  baseUrl: string,
  storagePath: string,
  size: ThumbSize,
  version?: number | null,
): string {
  const thumbPath = thumbStoragePath(storagePath, size);
  return `${baseUrl}/api/thumb/${thumbPath}${versionSuffix(version)}`;
}

/**
 * Build a root-relative /api/thumb URL — usable in any client context
 * (next/image src, srcSet) where an absolute URL with baseUrl is not needed.
 * Pass the photo's `thumb_version` so a re-baked thumbnail busts the CDN cache.
 */
export function thumbRelativeUrl(
  storagePath: string,
  size: ThumbSize,
  version?: number | null,
): string {
  return `/api/thumb/${thumbStoragePath(storagePath, size)}${versionSuffix(version)}`;
}
