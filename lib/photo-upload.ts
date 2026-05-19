import { Buffer } from 'node:buffer';
import sharp from 'sharp';

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

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'gif']);

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
};

/**
 * Low-level validator. Inspects magic bytes via Sharp and returns the
 * inferred content-type + canonical extension. Throws on:
 *   - buffer larger than `MAX_PHOTO_BYTES`
 *   - Sharp can't parse the buffer (not an image)
 *   - detected format is not in `ALLOWED_FORMATS`
 */
export async function validatePhotoBuffer(buffer: Buffer): Promise<ValidatedUpload> {
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error('File is too large. Maximum size is 50 MB per photo.');
  }

  let format: string | undefined;
  try {
    const metadata = await sharp(buffer).metadata();
    format = metadata.format;
  } catch {
    throw new Error('File is not a valid image.');
  }

  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw new Error('Unsupported image format.');
  }

  return {
    buffer,
    contentType: FORMAT_TO_CONTENT_TYPE[format],
    extension: FORMAT_TO_EXTENSION[format],
  };
}

/**
 * File-based wrapper. Kept for tests and any legacy caller still passing
 * `File`. New code should call `validatePhotoBuffer` directly.
 */
export async function validatePhotoUpload(file: File): Promise<ValidatedUpload> {
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('File is too large. Maximum size is 50 MB per photo.');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return validatePhotoBuffer(buffer);
}
