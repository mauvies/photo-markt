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
 * Build the public-facing /api/thumb URL for a stored thumbnail.
 * These are immutable, CDN-cached URLs — no signing required.
 */
export function thumbUrl(baseUrl: string, storagePath: string, size: ThumbSize): string {
  const thumbPath = thumbStoragePath(storagePath, size);
  return `${baseUrl}/api/thumb/${thumbPath}`;
}

/**
 * Build a root-relative /api/thumb URL — usable in any client context
 * (next/image src, srcSet) where an absolute URL with baseUrl is not needed.
 */
export function thumbRelativeUrl(storagePath: string, size: ThumbSize): string {
  return `/api/thumb/${thumbStoragePath(storagePath, size)}`;
}
