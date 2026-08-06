/**
 * Client-safe avatar constants (T-182). Kept in their OWN module — NOT in
 * `avatar-upload.ts`, which imports Sharp at module scope and must never reach a
 * client bundle. Both the server validator and the client pre-check import from
 * here so the cap + accepted formats can't silently drift.
 */

import { MAX_SERVER_ACTION_UPLOAD_BYTES } from '@/lib/upload-limits';

/**
 * Max upload size, enforced server-side with the client pre-checking the same.
 *
 * ⚠️ **Pinned to the Server-Action transport cap (T-238), not chosen freely.** The
 * avatar bytes travel inside a Server Action, and Vercel kills any function request
 * body over 4.5 MB with an un-catchable platform 413 — so the previous 8 MB was a
 * limit the app advertised and the platform refused to honour: half of the accepted
 * range failed with a raw Vercel error page instead of {@link AVATAR_ACCEPT} copy.
 * Raising it again requires moving the avatar to a signed upload URL first.
 *
 * A larger pick isn't rejected out of hand: the picker downscales in the browser
 * before this check (see `avatar-upload.tsx`), and since the server re-encodes to a
 * 256 px square anyway, nothing of value is lost.
 */
export const MAX_AVATAR_BYTES = MAX_SERVER_ACTION_UPLOAD_BYTES;

/** Longest edge the browser downscales an oversized pick to before uploading.
 *  Comfortably above the stored 256 px square, so the crop still has pixels to
 *  work with. */
export const AVATAR_DOWNSCALE_MAX_EDGE = 1024;

/** Sharp format names accepted as INPUT (output is always re-encoded WebP). */
export const AVATAR_ALLOWED_FORMATS = ['jpeg', 'png', 'webp', 'heif', 'avif'] as const;

/** `accept` attribute for the file input — the browser MIME equivalents. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif';
