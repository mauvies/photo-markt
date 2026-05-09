/**
 * Server-side image watermarking utilities.
 *
 * Preview pipeline (applied in order):
 *   1. Resize  — longest side capped at 1200 px (never upscales)
 *   2. Watermark — tiled diagonal "PHOTO MARKT" grid at 17% opacity
 *   3. Noise   — subtle grayscale grain at ~3% opacity
 *   4. Encode  — JPEG at quality 82
 *
 * The watermark text is rendered via opentype.js + a bundled Inter Bold WOFF
 * file converted to SVG `<path>` elements at runtime. We can't use SVG
 * `<text>` here because Vercel's serverless environment has no fontconfig,
 * so librsvg (Sharp's SVG renderer) can't resolve `font-family` lookups —
 * the text would render blank. Pre-converting glyphs to vector paths
 * sidesteps the font system entirely.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import sharp from 'sharp';

// Load and parse the bundled font once at module init. Reading once is fine
// because the lambda warms once per cold start; subsequent invocations reuse
// the parsed font from memory.
let cachedFont: opentype.Font | null = null;
function getFont(): opentype.Font {
  if (cachedFont) return cachedFont;
  const fontPath = path.join(process.cwd(), 'lib', 'fonts', 'Inter-Bold.woff');
  const buffer = readFileSync(fontPath);
  // opentype.parse expects an ArrayBuffer; slice exposes the underlying one.
  cachedFont = opentype.parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  return cachedFont;
}

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
    .jpeg({ quality: 70 })
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

  const font = getFont();

  // Scale font to image size so the mark looks the same proportionally
  const fontSize = Math.max(14, Math.min(22, Math.floor(Math.min(width, height) / 26)));

  // Render the text once as an SVG path string. We position the glyphs at
  // origin (0, 0) inside a `<symbol>`, then `<use>` it at every tile location
  // so the path data isn't repeated dozens of times in the SVG output.
  const textPath = font.getPath(TEXT, 0, 0, fontSize);
  const pathData = textPath.toPathData(2); // 2 decimal places — keep it compact

  // Measure the rendered text bounding box for tile spacing.
  const bbox = textPath.getBoundingBox();
  const textWidth = bbox.x2 - bbox.x1;
  const textHeight = bbox.y2 - bbox.y1;

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
      // Center vertically on the tile's y by offsetting half the text height
      const ty = Math.floor(y + textHeight / 2);
      elements.push(
        `<use href="#wm" x="${tx}" y="${ty}" transform="rotate(${ANGLE},${tx},${ty})"/>`,
      );
    }
  }

  // overflow="hidden" clips anything outside the viewport (default SVG behaviour,
  // stated explicitly for librsvg compatibility)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" overflow="hidden"><defs><path id="wm" d="${pathData}" fill="#ffffff" fill-opacity="${OPACITY}"/></defs>${elements.join('')}</svg>`;
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
