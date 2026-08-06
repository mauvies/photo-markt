/**
 * Transport limits for image bytes (T-238). Client-safe — no Node/Sharp imports,
 * so both the browser pre-check and the server gate read the SAME numbers.
 *
 * ## The rule this module exists to enforce
 *
 * **A Server Action must never carry bulk image bytes in production.** Vercel caps
 * a serverless function's request body at 4.5 MB and that cap **cannot be raised by
 * configuration** — `next.config.ts`'s `serverActions.bodySizeLimit` is honoured in
 * local dev but loses to the platform on Vercel, which answers with its own 413
 * (`FUNCTION_PAYLOAD_TOO_LARGE`) before the request ever reaches our code. The
 * response is therefore un-catchable: no `try/catch`, no toast, no localized copy —
 * the user sees a raw Vercel error page. That is exactly how the reported cover-image
 * bug behaved, and why the app's own 50 MB / 8 MB / 10 MB caps were fiction.
 *
 * Two ways to stay under it, both used here:
 *   1. **Don't send the bytes through the function at all** — mint a signed upload
 *      URL and have the browser PUT straight to Supabase Storage (photos have always
 *      done this; covers now do too, see `upload-event-cover.ts`). This is the only
 *      option when the file is genuinely large.
 *   2. **Shrink before sending** — downscale in the browser and cap what may cross
 *      the boundary at {@link MAX_SERVER_ACTION_UPLOAD_BYTES}. Fine for avatars and
 *      selfies, which get re-encoded down server-side anyway, so the full-resolution
 *      bytes were never worth transmitting.
 */

/**
 * Vercel's hard request-body limit for a serverless function invocation. Not
 * configurable — documented at
 * https://vercel.com/docs/functions/runtimes#request-body-size. Exported so tests
 * (and any future upload surface) can assert our own caps stay below it.
 */
export const VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

/**
 * The most a single image may weigh when it still travels inside a Server Action.
 * Deliberately below {@link VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES}: the multipart
 * envelope, the action id and the other form fields all ride in the same body, so a
 * cap set AT the platform limit would still 413 on a file that exactly hits it.
 * The half-megabyte gap is that headroom.
 */
export const MAX_SERVER_ACTION_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Human-facing rendering of {@link MAX_SERVER_ACTION_UPLOAD_BYTES} ("4 MB"), so the
 *  dictionaries and this module can't drift on the number the user is told. */
export const MAX_SERVER_ACTION_UPLOAD_MB = Math.floor(
  MAX_SERVER_ACTION_UPLOAD_BYTES / (1024 * 1024),
);

/**
 * Per-file cap for photos AND event covers — both go **direct to Storage** via a
 * signed upload URL, so the platform body limit above simply does not apply to them
 * and the app's own number is the only one in play. Lives here rather than in
 * `photo-upload.ts` (which imports Sharp at module scope) so the browser pre-check
 * and the server validator can share one constant; `photo-upload.ts` re-exports it.
 */
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;

/** Human-facing rendering of {@link MAX_PHOTO_BYTES} ("50 MB"). */
export const MAX_PHOTO_MB = Math.floor(MAX_PHOTO_BYTES / (1024 * 1024));
