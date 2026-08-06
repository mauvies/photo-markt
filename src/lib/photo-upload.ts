import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES } from '@/lib/upload-limits';

/**
 * Server-side validation for photo uploads.
 *
 * Trusting `file.type` (client-supplied MIME) lets attackers submit `.svg` or
 * `.html` payloads with `Content-Type: image/jpeg`. We instead detect the
 * format from the actual bytes via Sharp, then derive the storage extension
 * and content-type from the detected format — never from user input.
 *
 * Two entry points:
 *   - `validatePhotoBuffer(buffer)` — used by the Inngest worker after it
 *     downloads photo bytes directly from Storage. The direct-upload flow
 *     never has the bytes inside a Server Action.
 *   - `validatePhotoUpload(file)` — wrapper kept for tests + any legacy
 *     caller that still works with `File`. Re-derives the buffer from the
 *     File and delegates.
 */

// Re-exported (not defined) here: the number is shared with the browser pre-checks,
// and this module pulls Sharp into whatever imports it. See `upload-limits.ts`.
export { MAX_PHOTO_BYTES };

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'gif']);

/**
 * Per-call overrides so non-photo upload paths (e.g. avatars, T-182) can reuse
 * the exact magic-byte detection with a tighter cap / format allow-list without
 * touching the photo call-site. Defaults preserve the photo behavior.
 */
export type ValidateUploadOptions = {
  /** Max byte size. Defaults to {@link MAX_PHOTO_BYTES} (50 MB). */
  maxBytes?: number;
  /** Sharp format names to accept (e.g. `['jpeg','png','webp']`). Defaults to
   * the full photo set. Must be a subset of the formats Sharp can decode. */
  allowedFormats?: readonly string[];
  /** Message thrown when the buffer exceeds `maxBytes`. */
  tooLargeMessage?: string;
};

const FORMAT_TO_CONTENT_TYPE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heif: 'image/heic',
  avif: 'image/avif',
  gif: 'image/gif',
};

const FORMAT_TO_EXTENSION: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  heif: 'heic',
  avif: 'avif',
  gif: 'gif',
};

export type ValidatedUpload = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  /** Displayed pixel dimensions, EXIF-orientation-corrected. `null` when
   * Sharp can't determine them. */
  width: number | null;
  height: number | null;
};

/**
 * Low-level validator. Inspects magic bytes via Sharp and returns the
 * inferred content-type + canonical extension + displayed dimensions.
 * Throws on:
 *   - buffer larger than `MAX_PHOTO_BYTES`
 *   - Sharp can't parse the buffer (not an image)
 *   - detected format is not in `ALLOWED_FORMATS`
 */
export async function validatePhotoBuffer(
  buffer: Buffer,
  options?: ValidateUploadOptions,
): Promise<ValidatedUpload> {
  const maxBytes = options?.maxBytes ?? MAX_PHOTO_BYTES;
  const allowedFormats = options?.allowedFormats
    ? new Set(options.allowedFormats)
    : ALLOWED_FORMATS;

  if (buffer.byteLength > maxBytes) {
    throw new Error(
      options?.tooLargeMessage ?? 'File is too large. Maximum size is 50 MB per photo.',
    );
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new Error('File is not a valid image.');
  }

  const format = metadata.format;
  if (!format || !allowedFormats.has(format)) {
    throw new Error('Unsupported image format.');
  }

  // EXIF orientation 5-8 rotates the image a quarter turn — the displayed
  // dimensions are the stored ones swapped. Store the displayed dimensions
  // so the gallery reserves the correct aspect ratio.
  const swapAxes = (metadata.orientation ?? 1) >= 5;
  const rawWidth = metadata.width ?? null;
  const rawHeight = metadata.height ?? null;

  return {
    buffer,
    contentType: FORMAT_TO_CONTENT_TYPE[format],
    extension: FORMAT_TO_EXTENSION[format],
    width: swapAxes ? rawHeight : rawWidth,
    height: swapAxes ? rawWidth : rawHeight,
  };
}

/**
 * File-based wrapper. Kept for tests and any legacy caller still passing
 * `File`. New code should call `validatePhotoBuffer` directly.
 */
export async function validatePhotoUpload(
  file: File,
  options?: ValidateUploadOptions,
): Promise<ValidatedUpload> {
  const maxBytes = options?.maxBytes ?? MAX_PHOTO_BYTES;
  if (file.size > maxBytes) {
    throw new Error(
      options?.tooLargeMessage ?? 'File is too large. Maximum size is 50 MB per photo.',
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return validatePhotoBuffer(buffer, options);
}
