/**
 * Server-side image watermarking and degradation utilities.
 *
 * Preview pipeline (applied in order):
 *   1. Resize  — longest side capped at 1200 px (never upscales)
 *   2. Degrade — -25% saturation, +10% contrast (harder to colour-correct)
 *   3. Watermark — tiled diagonal "PHOTO MARKT" grid at 17% opacity
 *   4. Noise   — subtle grayscale grain at ~3% opacity
 *   5. Encode  — JPEG at quality 65
 */

import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Takes the raw original image buffer and returns a degraded, watermarked
 * JPEG preview buffer.  Always outputs JPEG regardless of the input format.
 */
export async function addWatermarkToImage(imageBuffer: Buffer): Promise<Buffer> {
  // ── 1 + 2: resize + colour degradation ──────────────────────────────────
  const { data: degradedBuffer, info } = await sharp(imageBuffer)
    .rotate() // honour EXIF orientation before anything else
    .resize({
      width: 1200,
      height: 1200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Reduce saturation by 25 % so the preview is harder to colour-correct
    .modulate({ saturation: 0.75 })
    // Contrast boost centred on mid-grey: output = 1.1 * input − 12.8
    .linear(1.1, -12.8)
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;

  // ── 3: tiled diagonal watermark ─────────────────────────────────────────
  const watermarkSvg = buildWatermarkSvg(w, h);

  // ── 4: subtle grayscale noise ───────────────────────────────────────────
  const noiseImageBuffer = await buildNoiseBuffer(w, h);

  // ── 5: composite + encode ───────────────────────────────────────────────
  return sharp(degradedBuffer)
    .composite([
      // Watermark text grid on top
      {
        input: Buffer.from(watermarkSvg),
        top: 0,
        left: 0,
        blend: 'over',
      },
      // Grayscale grain layer (~3 % opacity via alpha channel)
      {
        input: noiseImageBuffer,
        top: 0,
        left: 0,
        blend: 'over',
      },
    ])
    .jpeg({ quality: 65 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a full-size SVG that tiles "PHOTO MARKT" diagonally across the
 * image.  Each tile is individually rotated at −30 °around its own centre
 * so the grid stays fully readable while covering the whole canvas.
 *
 * Design choices that make removal hard:
 *  - Staggered rows (brick-wall offset) — no clear horizontal/vertical crop
 *  - Coverage extends slightly beyond the image border so edge tiles are
 *    still clearly visible
 *  - 17 % white opacity — visible enough to deter colour editing, subtle
 *    enough not to destroy the preview
 */
function buildWatermarkSvg(width: number, height: number): string {
  const TEXT = 'PHOTO MARKT';
  const ANGLE = -30; // degrees
  const OPACITY = 0.17;

  // Scale font to image size so the mark looks the same proportionally
  const fontSize = Math.max(14, Math.min(22, Math.floor(Math.min(width, height) / 26)));

  // Approximate rendered text dimensions
  const approxCharWidth = fontSize * 0.62;
  const textWidth = TEXT.length * approxCharWidth;

  // Tile spacing — slightly larger than the text so there's breathing room
  const spacingX = Math.ceil(textWidth * 1.6);
  const spacingY = Math.ceil(fontSize * 4.5);

  // Extra margin so tiles near the edges remain fully visible after rotation
  const extra = Math.ceil(Math.max(width, height) * 0.35);

  const elements: string[] = [];
  let rowIdx = 0;

  for (let y = -extra; y < height + extra; y += spacingY, rowIdx++) {
    // Brick-wall stagger: odd rows offset by half a column width
    const stagger = rowIdx % 2 === 0 ? 0 : Math.floor(spacingX / 2);

    for (let x = -extra; x < width + extra; x += spacingX) {
      const tx = Math.floor(x + stagger);
      const ty = Math.floor(y);
      elements.push(
        `<text x="${tx}" y="${ty}" transform="rotate(${ANGLE},${tx},${ty})" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" fill-opacity="${OPACITY}" dominant-baseline="middle">${TEXT}</text>`,
      );
    }
  }

  // overflow="hidden" clips anything outside the viewport (default SVG behaviour,
  // stated explicitly for librsvg compatibility)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" overflow="hidden">${elements.join('')}</svg>`;
}

/**
 * Creates a raw RGBA noise buffer and returns it as a PNG so Sharp can
 * composite it.  Each pixel is an independent random grayscale value at
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
