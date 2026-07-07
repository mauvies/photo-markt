/**
 * Server-side image watermarking utilities.
 *
 * Preview pipeline (applied in order):
 *   1. Resize  — longest side capped at 1024 px (never upscales)
 *   2. Watermark — pre-rendered transparent PNG tile composited with `tile: true`
 *   3. Noise   — subtle grayscale grain at ~3% opacity
 *   4. Encode  — JPEG at quality 70
 *
 * The watermark itself lives at `public/watermark/watermark-tile.png` — a
 * transparent PNG holding a regular diagonal "Photo Markt" mosaic (alternating
 * large symbol-bearing and small plain labels) baked in at the desired
 * angle/opacity. Sharp's composite repeats it across the whole image with one
 * call. Iterating the design is `pnpm watermark:gen` (tune the config in
 * `lib/watermark-tile.ts` and regenerate the committed PNG); no runtime code
 * changes needed.
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

export interface FaceBox {
  /** AWS Rekognition normalized box: Left/Top/Width/Height in 0–1. */
  boundingBox: Record<string, number>;
  confidence: number;
}

// Face-blur knobs. A blurred face makes the athlete unidentifiable, so an
// AI-cleaned copy is worthless — the strongest anti-theft lever, stronger than
// the old single-face watermark badge (which this replaces). We blur EVERY
// detected face (protect everyone until purchase), with a margin so the blurred
// zone has no sharp edge ring, and a sigma that scales with the face size.
const FACE_BLUR_MARGIN = 0.15; // expand each side by this fraction of the box
const FACE_BLUR_MIN_PX = 8; // skip regions smaller than this after clamping
// Skip implausibly large boxes (fraction of the frame area). A real event face
// never fills most of the frame; a box this big is a spurious Rekognition
// detection or a face-dominant close-up. Blurring it would smear the whole
// preview into an unrecognizable, unsellable image (and the margin+clamp would
// snap it to the full frame), so we degrade to tile-only — matching the prior
// overlay's "oversized box → tile-only" safety net.
const FACE_BLUR_MAX_AREA = 0.6;
const FACE_BLUR_MIN_SIGMA = 8;
const FACE_BLUR_MAX_SIGMA = 60;

export interface BlurRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure geometry: map EVERY usable indexed face box (normalized 0–1) to pixel
 * coordinates on the resized preview, expand each by `FACE_BLUR_MARGIN`, and
 * clamp to the image bounds. Degenerate, off-image, and implausibly large boxes
 * (> `FACE_BLUR_MAX_AREA` of the frame) are dropped so we never blur the whole
 * preview. Returns [] when there are no usable boxes — the caller then degrades
 * to tile-only. Exported for unit testing; this is the logic that can break.
 */
export function computeFaceBlurRects(
  faceBoxes: FaceBox[] | undefined,
  width: number,
  height: number,
): BlurRect[] {
  const rects: BlurRect[] = [];
  for (const face of faceBoxes ?? []) {
    const box = face.boundingBox;
    if (!box) continue;

    // Oversized/spurious box → degrade to tile-only rather than smear the
    // whole frame into an unsellable blur.
    if ((box.Width ?? 0) * (box.Height ?? 0) > FACE_BLUR_MAX_AREA) continue;

    const boxW = (box.Width ?? 0) * width;
    const boxH = (box.Height ?? 0) * height;
    const marginX = boxW * FACE_BLUR_MARGIN;
    const marginY = boxH * FACE_BLUR_MARGIN;

    let left = Math.round((box.Left ?? 0) * width - marginX);
    let top = Math.round((box.Top ?? 0) * height - marginY);
    let rectW = Math.round(boxW + 2 * marginX);
    let rectH = Math.round(boxH + 2 * marginY);

    // Clamp to bounds, shrinking width/height so left+width stays on-image.
    if (left < 0) {
      rectW += left;
      left = 0;
    }
    if (top < 0) {
      rectH += top;
      top = 0;
    }
    if (left + rectW > width) rectW = width - left;
    if (top + rectH > height) rectH = height - top;

    if (rectW < FACE_BLUR_MIN_PX || rectH < FACE_BLUR_MIN_PX) continue;
    rects.push({ left, top, width: rectW, height: rectH });
  }
  return rects;
}

/**
 * Build composite entries that blur each face region. Each rect is extracted,
 * Gaussian-blurred at a size-scaled sigma, and composited back opaquely over its
 * own location — under the watermark tile, so the tile stays readable on top.
 * Returns [] when there are no usable boxes, so the caller degrades to tile-only.
 *
 * The preview is decoded to raw pixels ONCE and every face extracts from that
 * shared raw buffer — a crowd photo with many faces would otherwise re-decode
 * the whole JPEG per face on the hot `/api/watermark` request path.
 */
async function buildFaceBlurComposites(
  baseBuffer: Buffer,
  rects: BlurRect[],
): Promise<sharp.OverlayOptions[]> {
  if (rects.length === 0) return [];

  const { data: raw, info } = await sharp(baseBuffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  return Promise.all(
    rects.map(async (rect) => {
      const sigma = Math.max(
        FACE_BLUR_MIN_SIGMA,
        Math.min(FACE_BLUR_MAX_SIGMA, Math.round(Math.min(rect.width, rect.height) / 4)),
      );
      const blurred = await sharp(raw, { raw: { width, height, channels } })
        .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        .blur(sigma)
        .raw()
        .toBuffer();
      return {
        input: blurred,
        raw: { width: rect.width, height: rect.height, channels },
        top: rect.top,
        left: rect.left,
        blend: 'over' as const,
      };
    }),
  );
}

/**
 * Takes the raw original image buffer and returns a degraded, watermarked
 * JPEG preview buffer. Always outputs JPEG regardless of the input format.
 *
 * When `faceBoxes` are supplied (from the Rekognition flow), EVERY detected
 * face is blurred to non-identifiable before the tile is composited on top —
 * a second anti-theft layer so an AI-cleaned copy still has no usable face.
 * Face data is best-effort: an empty/undefined list just yields the tile-only
 * preview. Only this derived buffer is blurred; the original is never touched.
 */
export async function addWatermarkToImage(
  imageBuffer: Buffer,
  faceBoxes?: FaceBox[],
): Promise<Buffer> {
  // Resize first so the watermark tile composites at a consistent density
  // regardless of the original photo size.
  const { data: degradedBuffer, info } = await sharp(imageBuffer)
    .rotate() // honour EXIF orientation before anything else
    .resize({
      // 1024 px longest side ("social media res", matches Sportograf). An
      // AI-cleaned copy at this size is unusable for print/large display, which
      // is the real anti-removal lever — not out-watermarking the AI.
      width: 1024,
      height: 1024,
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

  // Blur every detected face on the resized preview, UNDER the tile, so the
  // watermark stays readable on top of the blurred zones.
  const faceBlurs = await buildFaceBlurComposites(
    degradedBuffer,
    computeFaceBlurRects(faceBoxes, w, h),
  );

  return sharp(degradedBuffer)
    .composite([
      // Blurred face regions first (beneath the tile).
      ...faceBlurs,
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
