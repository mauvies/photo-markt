/**
 * Downscale + re-encode photo bytes before sending to AWS Rekognition.
 *
 * Rekognition has a 5 MB inline-bytes ceiling on IndexFaces / SearchFacesByImage.
 * The original photos uploaded by photographers routinely exceed that, so
 * every call goes through this pipeline first. Mirrors the Sharp setup in
 * `lib/watermark.ts:47-70`:
 *
 *   1. `.rotate()` — honor EXIF orientation so portrait photos aren't sideways
 *      from the face detector's perspective.
 *   2. `.resize({ width: 1920, withoutEnlargement: true })` — Rekognition
 *      tolerates faces as small as ~80×80, so 1920 wide is comfortable for
 *      accuracy while keeping bytes well under 5 MB.
 *   3. `.jpeg({ quality: 85 })` — re-encode to a single format AWS handles
 *      cheaply, strips EXIF in the process.
 */

import sharp from 'sharp';

export async function prepareImageForRekognition(buffer: Buffer): Promise<Buffer> {
  return await sharp(buffer)
    .rotate()
    .resize({ width: 1920, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
