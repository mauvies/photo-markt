/**
 * Client-safe avatar constants (T-182). Kept in their OWN module — NOT in
 * `avatar-upload.ts`, which imports Sharp at module scope and must never reach a
 * client bundle. Both the server validator and the client pre-check import from
 * here so the cap + accepted formats can't silently drift.
 */

/** Max raw upload size. Enforced server-side; the client pre-checks the same. */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

/** Sharp format names accepted as INPUT (output is always re-encoded WebP). */
export const AVATAR_ALLOWED_FORMATS = ['jpeg', 'png', 'webp', 'heif', 'avif'] as const;

/** `accept` attribute for the file input — the browser MIME equivalents. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif';
