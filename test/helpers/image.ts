/**
 * Shared image test helpers for the watermark / face-blur suites.
 *
 * Both the unit test (`addWatermarkToImage`) and the integration test
 * (`generate-photo-thumbnails`) need a high-frequency source and a way to
 * measure how much detail survives in a sub-region, to prove a face blur
 * actually collapsed the detail there.
 */
import sharp from 'sharp';

/**
 * Build a coarse checkerboard — high-frequency detail that survives resize +
 * JPEG, so a strong blur is measurable as a big drop in local stdev (a flat
 * fill wouldn't change under blur).
 */
export async function checkerboardJpeg(
  width: number,
  height: number,
  cell = 16,
  quality = 90,
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 255 : 0;
      const o = (y * width + x) * 3;
      raw[o] = v;
      raw[o + 1] = v;
      raw[o + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer();
}

/**
 * Stdev of a sub-region — a proxy for how much detail remains. Extract to its
 * own buffer first: sharp's `.stats()` reads the source image and ignores a
 * queued `.extract()`, so measuring the crop needs a fresh pipeline.
 */
export async function regionStdev(
  buf: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const cropped = await sharp(buf).extract(region).toBuffer();
  const stats = await sharp(cropped).stats();
  return stats.channels[0].stdev;
}
