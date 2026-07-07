/**
 * Detect a definitive "object not found" error from Supabase Storage, as
 * opposed to a transient network/server error. Supabase Storage's `download()`
 * never throws on a missing object — it resolves `{ data: null, error }` where
 * `error` is a `StorageApiError` shaped like
 * `{ message: "Object not found", status: 400, statusCode: "404" }` (verified
 * against the local Storage emulator; `status` is the wrapping HTTP status,
 * `statusCode` carries the real semantic code as a string).
 *
 * Used by the Inngest workers (`index-photo-faces`, `generate-photo-thumbnails`,
 * `detect-photo-bibs`) to throw a `NonRetriableError` instead of retrying a
 * download that will never succeed — see T-071 (the local-dev environment
 * mismatch that originally surfaced this: the Inngest job runs on a deployed
 * environment whose Supabase project differs from the one a local `pnpm dev`
 * process uploaded to).
 */
export function isStorageObjectNotFound(
  error: { message?: string; statusCode?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.statusCode === '404') return true;
  return (error.message ?? '').toLowerCase().includes('object not found');
}
