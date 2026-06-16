/**
 * Server-side image watermarking utilities.
 *
 * Preview pipeline (applied in order):
 *   1. Resize  — longest side capped at 1200 px (never upscales)
 *   2. Watermark — pre-rendered transparent PNG tile composited with `tile: true`
 *   3. Noise   — subtle grayscale grain at ~3% opacity
 *   4. Encode  — JPEG at quality 70
 *
 * The watermark itself lives at `public/watermark/watermark-tile.png` — a
 * transparent PNG with "PHOTO MARKT" baked in at the desired angle/opacity.
 * Sharp's composite repeats it across the whole image with one call. Iterating
 * the design is a Canva job + replacing the file; no code changes needed.
 *
 * Why a static PNG instead of runtime SVG/text rendering: Vercel's serverless
 * runtime has no fontconfig and a stale librsvg, so anything that resolves
 * font names or uses SVG `<use>` references is unreliable in prod. A raster
 * tile bypasses every fragile font/SVG codepath.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const WATERMARK_TILE_PATH = path.join(process.cwd(), 'public', 'watermark', 'watermark-tile.png');

// Cache the tile buffer (and its dimensions) once per cold start. The file is
// small (~5 KB) and reading/probing it on every request would be wasteful.
let cachedTile: { buffer: Buffer; width: number; height: number } | null = null;
async function getTile(): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (cachedTile) return cachedTile;
  const buffer = await sharp(WATERMARK_TILE_PATH).toBuffer();
  const { width = 0, height = 0 } = await sharp(buffer).metadata();
  cachedTile = { buffer, width, height };
  return cachedTile;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Takes the raw original image buffer and returns a degraded, watermarked
 * JPEG preview buffer. Always outputs JPEG regardless of the input format.
 */
export async function addWatermarkToImage(imageBuffer: Buffer): Promise<Buffer> {
  // Resize first so the watermark tile composites at a consistent density
  // regardless of the original photo size.
  const { data: degradedBuffer, info } = await sharp(imageBuffer)
    .rotate() // honour EXIF orientation before anything else
    .resize({
      width: 1200,
      height: 1200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;

  const [tile, noiseBuffer] = await Promise.all([getTile(), buildNoiseBuffer(w, h)]);

  // Sharp throws "Image to composite must have same dimensions or smaller" when
  // a composite input is larger than the base — even with `tile: true`. This
  // happens for source images smaller than the tile (the resize above keeps
  // previews small via `withoutEnlargement`). Shrink the tile to fit so it
  // still repeats across the whole preview.
  const tileInput =
    tile.width > w || tile.height > h
      ? await sharp(tile.buffer)
          .resize({ width: w, height: h, fit: 'inside', withoutEnlargement: true })
          .toBuffer()
      : tile.buffer;

  return sharp(degradedBuffer)
    .composite([
      // `tile: true` repeats the input across the entire base image. Opacity
      // and rotation are pre-baked into the PNG, so no runtime adjustment.
      { input: tileInput, tile: true, blend: 'over' },
      // Grayscale grain layer (~3 % opacity via alpha channel)
      { input: noiseBuffer, top: 0, left: 0, blend: 'over' },
    ])
    .jpeg({ quality: 70 })
    .toBuffer();
}

/**
 * Returns a generic JPEG placeholder used when the watermark pipeline fails.
 * The route handler serves this in place of the original image — never serve
 * the un-watermarked original on error.
 *
 * Implementation note: the SVG uses only `<rect>` and `<g>` paths — no
 * `<text>` — so it renders identically regardless of fontconfig state.
 */
let cachedErrorPlaceholder: Buffer | null = null;
export async function buildWatermarkErrorPlaceholder(): Promise<Buffer> {
  if (cachedErrorPlaceholder) return cachedErrorPlaceholder;
  const size = 800;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <pattern id="stripe" patternUnits="userSpaceOnUse" width="80" height="80" patternTransform="rotate(-30)">
        <rect width="80" height="80" fill="#3f3f46"/>
        <rect width="40" height="80" fill="#52525b"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#stripe)"/>
    <g transform="translate(${size / 2 - 70},${size / 2 - 70})" fill="none" stroke="#a1a1aa" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="0" y="0" width="140" height="140" rx="14" ry="14"/>
      <path d="M10 100 L50 65 L80 95 L110 70 L130 90"/>
      <circle cx="45" cy="40" r="10" fill="#a1a1aa" stroke="none"/>
    </g>
  </svg>`;
  cachedErrorPlaceholder = await sharp(Buffer.from(svg)).jpeg({ quality: 60 }).toBuffer();
  return cachedErrorPlaceholder;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a raw RGBA noise buffer and returns it as a PNG so Sharp can
 * composite it. Each pixel is an independent random grayscale value at
 * alpha ≈ 3 % (value 8 out of 255).
 *
 * Using `randomBytes` instead of a per-pixel `Math.random()` loop is
 * significantly faster (one syscall for the whole buffer).
 */
async function buildNoiseBuffer(width: number, height: number): Promise<Buffer> {
  const pixelCount = width * height;
  // One random byte per pixel — we reuse it for R, G, B (grayscale grain)
  const grainValues = randomBytes(pixelCount);

  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    rgba[offset] = grainValues[i]; // R
    rgba[offset + 1] = grainValues[i]; // G
    rgba[offset + 2] = grainValues[i]; // B
    rgba[offset + 3] = 8; // A ≈ 3 %
  }

  return sharp(Buffer.from(rgba.buffer), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
