import { Buffer } from 'node:buffer';
import sharp from 'sharp';

/**
 * Server-side validation for photo uploads.
 *
 * Trusting `file.type` (client-supplied MIME) lets attackers submit `.svg` or
 * `.html` payloads with `Content-Type: image/jpeg`. We instead detect the
 * format from the actual bytes via Sharp, then derive the storage extension
 * and content-type from the detected format — never from user input.
 */

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

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

export async function validatePhotoUpload(file: File): Promise<ValidatedUpload> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File is too large. Maximum size is 50 MB per photo.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());

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
