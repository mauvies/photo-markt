import sharp from 'sharp';
import type { ThumbSize } from '@/lib/thumbnail-urls';

// Pure URL/path helpers live in thumbnail-urls.ts (no sharp) so they can be
// imported from client-reachable graphs; re-exported here so server-side
// callers keep a single import site. Do NOT add client-reachable imports of
// THIS module — it loads sharp at module scope.
export * from '@/lib/thumbnail-urls';

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
