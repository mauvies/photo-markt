/**
 * Sanitize errors thrown by third-party SDKs (AWS, Supabase, Sharp) before
 * they propagate into framework boundaries that serialize the entire error
 * graph (Inngest's step-failure record, Vercel's serverless error response).
 *
 * Why: AWS SDK v3 errors are particularly bloated — when `IndexFacesCommand`
 * or `SearchFacesByImageCommand` fail, the thrown error retains a reference
 * to the original request `Input` object, which contains `Image: { Bytes:
 * <full photo/selfie buffer> }`. Inngest captures every thrown error inside
 * `step.run()` as part of the step's failure record (so retries have
 * somewhere to start from); that serialization walks the entire error graph
 * including `cause`, `$response`, `$metadata`, and any prototype-attached
 * fields. For a 4 MB photo this blows past Inngest's ~4 MB per-step output
 * cap and the whole function fails with `output_too_large`.
 *
 * Used by:
 *   - `lib/inngest/functions/index-photo-faces.ts` — photographer indexing
 *   - `app/[lang]/events/[shareCode]/actions.ts:searchFacesInEvent`
 *     — talent face search (this PR)
 *
 * The defense: catch every potentially-throwing third-party call, **discard**
 * the original error completely, and re-throw a plain `Error` carrying ONLY
 * the message string. No `cause` (that's the exact channel the AWS error
 * chain bloats through), no metadata, no nested objects. The original error
 * name is preserved on the new Error solely for log readability — it's a
 * primitive string, not a reference.
 */
export async function safeCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safeErr = new Error(`${label}: ${message}`);
    if (err instanceof Error) safeErr.name = err.name;
    throw safeErr;
  }
}
