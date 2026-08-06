'use client';

/**
 * Browser-side image downscaling (T-238), used by the two surfaces that still send
 * image bytes THROUGH a Server Action — the avatar picker and the face-search selfie
 * modal. Both re-encode the image far smaller server-side anyway (a 256 px WebP
 * avatar; a Rekognition-sized selfie), so shipping the camera's full-resolution
 * original was pure waste — and, past Vercel's un-raisable 4.5 MB function-body
 * limit, an un-catchable 413. See `upload-limits.ts` for that rule.
 *
 * Deliberately best-effort: **any** failure returns the ORIGINAL file rather than
 * throwing. The browser is not the security boundary here — the Server Action still
 * re-validates magic bytes and re-checks the size cap — so the worst case of a failed
 * downscale is the caller's size guard rejecting the pick with localized copy, which
 * is the behaviour we'd have had anyway. Notably `createImageBitmap` cannot decode
 * HEIC/HEIF outside Safari, and phone HEICs are common: those simply pass through
 * untouched.
 */

export interface DownscaleOptions {
  /** Longest edge (px) of the result. Ignored if the image is already smaller. */
  maxEdge: number;
  /** Target byte ceiling. A file already under it is returned untouched. */
  maxBytes: number;
}

/** Quality ladder for the retry loop: encode, and if still too heavy, try harder. */
const QUALITY_STEPS = [0.82, 0.7, 0.55] as const;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Return a smaller JPEG version of `file`, or `file` itself when shrinking is
 * unnecessary or impossible.
 *
 * A file already under `maxBytes` is returned as-is — the point is transport weight,
 * not pixel count, and re-encoding a small image would only cost quality. EXIF
 * orientation is baked in (`imageOrientation: 'from-image'`) so a rotated phone photo
 * doesn't come out sideways once the metadata is dropped by the canvas.
 */
export async function downscaleImageFile(file: File, options: DownscaleOptions): Promise<File> {
  const { maxEdge, maxBytes } = options;
  if (file.size <= maxBytes) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Undecodable in this browser (HEIC outside Safari is the common case).
    return file;
  }

  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let best: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= maxBytes) break;
    }
    // Keep whichever is actually smaller — a tiny already-optimized JPEG can come
    // back BIGGER from a canvas re-encode, and shipping the bigger one would be a
    // regression dressed up as an optimization.
    if (!best || best.size >= file.size) return file;

    const renamed = file.name.replace(/\.[^./\\]+$/, '') || 'image';
    return new File([best], `${renamed}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
