import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { AVATAR_ALLOWED_FORMATS, MAX_AVATAR_BYTES } from '@/lib/avatar-constants';
import { type ValidatedUpload, validatePhotoUpload } from '@/lib/photo-upload';

/**
 * Avatar (profile-picture) upload helpers (T-182). Server-only — imports Sharp
 * at module scope, so never import this from a client-reachable graph. The
 * shared upload UI (`avatar-upload.tsx`) posts the File to the Server Action;
 * the action calls into here. Client-safe constants (size cap, accepted
 * formats) live in `avatar-constants.ts`.
 */

/** Public bucket the avatar objects live in (see the create-avatars-bucket migration). */
export const AVATAR_BUCKET = 'avatars';

/** Square edge (px) of the stored avatar. Retina-safe for every display size
 *  (the largest on-screen avatar is ~96px). */
export const AVATAR_EDGE_PX = 256;

/**
 * Validate a raw avatar upload: magic-byte format detection (never trusts
 * `file.type`) + the avatar size cap + the avatar format allow-list. Reuses the
 * photo validator with per-call overrides so the photo path is untouched.
 * Throws on a non-image, an unsupported format, or an oversized file.
 */
export async function validateAvatarUpload(file: File): Promise<ValidatedUpload> {
  return validatePhotoUpload(file, {
    maxBytes: MAX_AVATAR_BYTES,
    allowedFormats: AVATAR_ALLOWED_FORMATS,
    tooLargeMessage: 'Image is too large. Maximum size is 8 MB.',
  });
}

/**
 * Re-encode a validated avatar to a square WebP. `fit: 'cover'` center-crops to
 * a square so it fills the circular `<Avatar>` without distortion; the raw
 * upload is never stored.
 */
export async function resizeAvatar(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate() // honour EXIF orientation before cropping
    .resize({ width: AVATAR_EDGE_PX, height: AVATAR_EDGE_PX, fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer();
}

/** Build the storage object path for a user's new avatar: `<userId>/<uuid>.webp`. */
export function buildAvatarPath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.webp`;
}

/**
 * Given a stored `avatar_url`, return the object path to delete on replace/remove
 * — but ONLY when the URL points at THIS project's public `avatars` bucket AND
 * the object sits under the given user's folder. Returns null otherwise (e.g. a
 * Google OAuth avatar URL, or — defensively — a path outside the user's folder),
 * so delete-on-replace can never touch a foreign or non-owned object.
 */
export function avatarObjectPathToDelete(
  avatarUrl: string | null | undefined,
  userId: string,
): string | null {
  if (!avatarUrl) return null;
  // Public object URLs look like: <base>/storage/v1/object/public/avatars/<path>
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const idx = avatarUrl.indexOf(marker);
  if (idx === -1) return null;
  const objectPath = avatarUrl.slice(idx + marker.length).split('?')[0];
  if (!objectPath) return null;
  // Fail closed: only ever delete inside the caller's own folder.
  if (!objectPath.startsWith(`${userId}/`)) return null;
  return objectPath;
}
