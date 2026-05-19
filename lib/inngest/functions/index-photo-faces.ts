/**
 * `photo.uploaded` worker: validate a single photo's bytes, then (when AI
 * matching is enabled on the event) index its faces in AWS Rekognition.
 *
 * Step ordering (6 steps; bytes NEVER cross step boundaries):
 *
 *   1. check-event-state           → small JSON: { eventState, photoUserId,
 *                                                  eventOwnerId,
 *                                                  requireUploadApproval }
 *   2. process-photo               → THE mega-step. Downloads bytes,
 *                                    validates, (if invalid) rejects+deletes
 *                                    inline, (if valid + AI on) prepares
 *                                    and calls AWS IndexFaces. Returns
 *                                    only { outcome, reason?, faces? }.
 *                                    Buffer never escapes the step closure.
 *   3. promote-upload-status       → owner-vs-guest logic; skipped on
 *                                    outcome='rejected'.
 *   4. persist-faces               → photo_faces inserts (only on
 *                                    outcome='indexed' with faces.length>0).
 *   5. mark-result                 → terminal face_index_status; skipped on
 *                                    outcome='rejected'.
 *   6. maybe-mark-event-ready      → flips events.ai_matching_status when
 *                                    fan-out completes.
 *
 * Why one mega-step instead of separate download/validate/prep/index
 * steps: each step's return value is serialized by Inngest for durable
 * replay; passing a Buffer (or its base64 encoding) between steps blows
 * past Inngest's ~4 MB per-step output cap and fails the entire function.
 * Keeping bytes local to a single step body sidesteps the cap.
 *
 * Trade-off: if AWS IndexFaces fails transiently, the retry re-runs the
 * full step (re-download + re-validate + re-prepare + re-IndexFaces).
 * Acceptable at our scale; saves an extra Storage download per photo
 * vs. splitting validation and indexing into two steps.
 *
 * Retries: 3× exponential. After the final retry, `onFailure` marks the
 * photo's `face_index_status='failed'`. `upload_status` is settled inside
 * step 2 or 3 — never touched by `onFailure`.
 */

import { revalidateTag } from 'next/cache';
import {
  addPhotoFace,
  countEventPhotosInFlight,
  type EventRekognitionState,
  getEventRekognitionState,
  updateEventRekognitionState,
  updatePhotoFaceIndexStatus,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { indexFaceForPhoto } from '@/lib/aws/face-indexing';
import { prepareImageForRekognition } from '@/lib/aws/image-prep';
import { validatePhotoBuffer } from '@/lib/photo-upload';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

export interface PhotoUploadedPayload {
  photoId: string;
  eventId: string;
  storagePath: string;
}

/**
 * The narrow subset of Inngest's `step` we depend on. Pulled out as an
 * interface so the integration test can substitute a pass-through fake
 * (`step.run(name, fn) → fn()`) without spinning up an Inngest runtime.
 */
export interface PhotoUploadStep {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Hard margin for the size-mismatch check. Honest re-encoding never grows
 * a file beyond a kilobyte's worth of metadata; anything larger is
 * size-gaming the storage cap.
 */
const SIZE_MISMATCH_MARGIN_BYTES = 1024;

interface PhotoRow {
  id: string;
  user_id: string;
  size_bytes: number | null;
  /** Non-null indicates a guest-collaborative upload (set by `uploadGuestPhoto`).
   *  Combined with the user_id-vs-owner check, this discriminates owner
   *  uploads from contributor/guest uploads for the approval-queue gate. */
  guest_name: string | null;
}

interface EventOwnerRow {
  user_id: string;
  require_upload_approval: boolean | null;
}

interface FaceRecord {
  awsFaceId: string;
  confidence: number;
  boundingBox: Record<string, number> | null;
}

/**
 * Discriminated union returned by the `process-photo` step. Each variant
 * is a small JSON payload — no Buffers, no large strings — so the whole
 * value can safely cross Inngest's step-output serializer.
 */
type ProcessOutcome =
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'no-ai' }
  | { outcome: 'indexed'; faces: FaceRecord[] };

async function loadPhotoRow(photoId: string): Promise<PhotoRow | null> {
  const { data, error } = await adminClient
    .from('photos')
    .select('id, user_id, size_bytes, guest_name')
    .eq('id', photoId)
    .maybeSingle();
  if (error || !data) return null;
  return data as PhotoRow;
}

async function loadEventOwnerRow(eventId: string): Promise<EventOwnerRow | null> {
  const { data, error } = await adminClient
    .from('events')
    .select('user_id, require_upload_approval')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data) return null;
  return data as EventOwnerRow;
}

async function deleteStorageObject(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from('photos').remove([path]);
  if (error) {
    // Best-effort: the orphan-cleanup cron will pick up anything left over.
    console.error('[index-photo-faces] failed to delete storage object', {
      path,
      error: error.message,
    });
  }
}

async function markRejected(photoId: string, path: string): Promise<void> {
  await deleteStorageObject(path);
  const { error } = await adminClient
    .from('photos')
    .update({ upload_status: 'rejected', face_index_status: 'not_applicable' })
    .eq('id', photoId);
  if (error) {
    throw new Error(`Failed to mark photo rejected: ${error.message}`);
  }
}

/**
 * Sanitize errors thrown by third-party SDKs (AWS, Supabase, Sharp) before
 * they reach Inngest's step-failure serializer.
 *
 * Why: AWS SDK v3 errors are particularly bloated — when `IndexFacesCommand`
 * fails, the thrown error retains a reference to the original request
 * `Input` object, which contains `Image: { Bytes: <full photo buffer> }`.
 * Inngest captures every thrown error inside `step.run()` as part of the
 * step's failure record (so retries have somewhere to start from); that
 * serialization walks the entire error graph including `cause`, `$response`,
 * `$metadata`, and any prototype-attached fields. For a 4 MB photo, the
 * serialized error blows past Inngest's ~4 MB per-step output cap and the
 * whole function fails with `output_too_large`.
 *
 * The defense: catch every potentially-throwing third-party call,
 * **discard** the original error completely, and re-throw a plain `Error`
 * carrying ONLY the message string. No `cause` (that's the exact channel
 * the AWS error chain bloats through), no metadata, no nested objects.
 * The original error name is preserved on the new Error solely for log
 * readability — it's a primitive string, not a reference.
 */
async function safeCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safeErr = new Error(`${label}: ${message}`);
    if (err instanceof Error) safeErr.name = err.name;
    throw safeErr;
  }
}

async function promoteToApproved(photoId: string): Promise<void> {
  const { error } = await adminClient
    .from('photos')
    .update({ upload_status: 'approved' })
    .eq('id', photoId);
  if (error) {
    throw new Error(`Failed to promote photo to approved: ${error.message}`);
  }
}

/**
 * Invalidate the public-event photo cache for an event after the worker
 * promotes one of its photos to `upload_status='approved'`. Without this,
 * the `getCachedEventData` in `app/[lang]/events/[shareCode]/page.tsx`
 * (55-min TTL) keeps serving the pre-promotion photo list, so newly
 * approved photos stay invisible to talents until the TTL elapses.
 *
 * Best-effort — failures here only delay visibility, never block the
 * worker's terminal state writes. Inngest's `revalidateTag` is available
 * here because the worker runs as a Next.js Route Handler.
 */
async function invalidateEventPhotoCache(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('events')
      .select('slug, share_code')
      .eq('id', eventId)
      .maybeSingle();
    revalidateTag(`event-${eventId}`, 'max');
    const slug = (data?.slug as string | null) ?? null;
    const shareCode = (data?.share_code as string | null) ?? null;
    if (slug) revalidateTag(`event-${slug}`, 'max');
    if (shareCode) revalidateTag(`event-${shareCode}`, 'max');
  } catch (err) {
    console.error('[index-photo-faces] revalidateTag failed', err);
  }
}

export const indexPhotoFaces = inngest.createFunction(
  {
    id: 'index-photo-faces',
    // Per-event concurrency cap so a single 2000-photo bulk upload doesn't
    // drown out other events' work or hammer AWS in one shot.
    // Limit set to 5 to fit the Inngest free-tier plan ceiling.
    // TODO: raise to 10–50 once we upgrade to Inngest Pro (Pro caps are
    // 50/function on Hobby and higher on Team).
    concurrency: [{ limit: 5, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'photo.uploaded' }],
    onFailure: async ({ event }) => {
      const inner = (event.data as { event?: { data?: PhotoUploadedPayload } })?.event;
      const photoId = inner?.data?.photoId;
      if (!photoId) return;
      try {
        // On final-retry failure, mark only the indexing pipeline failed.
        // upload_status was settled in step 2 (rejected) or step 3 (approved
        // /pending) before we got here; leaving it untouched preserves whatever
        // outcome was reached, so the owner can Re-index later.
        await updatePhotoFaceIndexStatus(adminClient, photoId, 'failed');
      } catch (err) {
        console.error('[index-photo-faces] onFailure cleanup failed', err);
      }
    },
  },
  async ({ event, step }) => {
    // Inngest's `step.run` return is `Jsonify<Awaited<T>>` (since the result
    // crosses a JSON boundary on durable replays). At runtime that's the
    // same value; the cast pins our narrower `PhotoUploadStep` signature
    // so tests can substitute a pass-through fake.
    return await runIndexPhotoFacesFlow(
      event.data as PhotoUploadedPayload,
      step as unknown as PhotoUploadStep,
    );
  },
);

interface CheckEventStateResult {
  eventState: EventRekognitionState | null;
  photoUserId: string | null;
  /** Non-null = guest-collaborative upload (uploadGuestPhoto sets this). */
  photoGuestName: string | null;
  eventOwnerId: string | null;
  requireUploadApproval: boolean;
}

/**
 * Diagnostic helper — wraps a `step.run` call to log the serialized byte
 * size of its return value. The log line is parseable by `grep '\[step-size\]'`
 * and pinpoints which step is approaching Inngest's ~4 MB per-step output
 * cap. Production-safe: console.log only, no behavior change.
 *
 *   [step-size] step=<name> photoId=<id> bytes=<n>
 *
 * For void-returning steps, `JSON.stringify(undefined)` is `undefined`
 * (no length); we report `bytes=0` in that case.
 */
async function loggedStepRun<T>(
  step: PhotoUploadStep,
  name: string,
  photoId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return step.run(name, async () => {
    const result = await fn();
    const serialized = JSON.stringify(result);
    const size = typeof serialized === 'string' ? serialized.length : 0;
    console.log(`[step-size] step=${name} photoId=${photoId} bytes=${size}`);
    return result;
  });
}

/**
 * Pure handler body extracted from the Inngest function. Same step ordering,
 * exported for integration tests that need to verify the flow without an
 * Inngest runtime. The `step` argument should be a real Inngest step in
 * production and a pass-through fake (`{ run: (_, fn) => fn() }`) in tests.
 */
export async function runIndexPhotoFacesFlow(
  payload: PhotoUploadedPayload,
  step: PhotoUploadStep,
): Promise<unknown> {
  const { photoId, eventId, storagePath } = payload;

  console.log(`[index-photo-faces] start photoId=${photoId} eventId=${eventId}`);

  // Log the incoming event payload size so a stuck run with bloated input
  // (shouldn't happen — `{photoId, eventId, storagePath}` is ~150 B) is
  // immediately visible alongside step-level diagnostics.
  console.log(
    `[step-size] input photoId=${payload.photoId} bytes=${JSON.stringify(payload).length}`,
  );

  // ── 1. check-event-state ─────────────────────────────────────────────
  // Pull every small primitive the rest of the flow needs. Three round-
  // trips coalesced into one step so the rest of the worker doesn't have
  // to revisit the DB just to make a binary decision.
  // step output: <500 B (small JSON of UUIDs + 4 booleans)
  const ctx: CheckEventStateResult = await loggedStepRun(
    step,
    'check-event-state',
    photoId,
    async () => {
      const eventState = await getEventRekognitionState(adminClient, eventId);
      const photo = await loadPhotoRow(photoId);
      const eventRow = await loadEventOwnerRow(eventId);
      return {
        eventState,
        photoUserId: photo?.user_id ?? null,
        photoGuestName: photo?.guest_name ?? null,
        eventOwnerId: eventRow?.user_id ?? null,
        requireUploadApproval: Boolean(eventRow?.require_upload_approval),
      };
    },
  );

  // ── 2. process-photo ─────────────────────────────────────────────────
  // The mega-step. Downloads bytes, validates, (if invalid) rejects+deletes
  // inline, (if valid + AI on) prepares for Rekognition and calls AWS
  // IndexFaces. Buffer is stack-local and GC'd at step exit. The return
  // is a small discriminated-union JSON — never a Buffer or base64 string.
  // step output: <2 KB (worst case = 10 faces × ~150 B each + JSON
  // overhead). NEVER returns the photo Buffer or base64 — that would
  // exceed Inngest's ~4 MB per-step output cap and fail every photo.
  const result: ProcessOutcome = await loggedStepRun(step, 'process-photo', photoId, async () => {
    /**
     * Every return path funnels through here. We log the serialized size
     * one last time before handing the value back to Inngest's step
     * serializer. The 10 KB threshold is a paranoid early-warning — the
     * typical worst case is ~2 KB (10 faces × ~150 B + JSON overhead);
     * anything north of 10 KB means a leak.
     */
    const finalize = (value: ProcessOutcome): ProcessOutcome => {
      const size = JSON.stringify(value).length;
      console.log(`[index-photo-faces] process-photo done photoId=${photoId} outputBytes=${size}`);
      if (size > 10 * 1024) {
        console.warn(
          `[index-photo-faces] WARNING process-photo output exceeds 10KB photoId=${photoId} outputBytes=${size}`,
        );
      }
      return value;
    };

    // 2a. Download — wrapped to keep any Supabase Storage error from
    //     carrying response bodies into Inngest's serializer.
    const { data, error } = await safeCall('storage-download', () =>
      supabaseAdmin.storage.from('photos').download(storagePath),
    );
    if (error || !data) {
      throw new Error(`Failed to download photo ${storagePath}: ${error?.message ?? 'no data'}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    // 2b. Validate magic bytes + declared size cap. On failure, delete from
    //     Storage and flip upload_status='rejected' in-step so the terminal
    //     state is reached without crossing any more step boundaries.
    const photo = await loadPhotoRow(photoId);
    if (!photo) {
      return finalize({ outcome: 'rejected' as const, reason: 'photo-row-missing' });
    }
    if (
      typeof photo.size_bytes === 'number' &&
      photo.size_bytes > 0 &&
      buffer.byteLength > photo.size_bytes + SIZE_MISMATCH_MARGIN_BYTES
    ) {
      await markRejected(photoId, storagePath);
      return finalize({ outcome: 'rejected' as const, reason: 'size-mismatch' });
    }
    try {
      // safeCall sanitizes any Sharp/validation error before it can reach
      // the catch — defensive only, since we already convert to a string
      // reason here. The wrapper is in place so a future caller can't
      // accidentally let a bloated error escape.
      await safeCall('validate-buffer', () => validatePhotoBuffer(buffer));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'validation-failed';
      await markRejected(photoId, storagePath);
      return finalize({ outcome: 'rejected' as const, reason });
    }

    // 2c. AI matching disabled, event flagged as containing minors, or no
    //     collection materialized yet → done; nothing to send to AWS.
    const state = ctx.eventState;
    if (!state || !state.enabled || state.containsMinors || !state.collectionId) {
      return finalize({ outcome: 'no-ai' as const });
    }

    // 2d. Prepare + call AWS IndexFaces. Both calls are wrapped: AWS SDK
    //     v3's IndexFacesCommand error retains the request `Input.Image.Bytes`
    //     (the entire photo Buffer) — exactly the leak that blows past
    //     Inngest's ~4 MB step-output cap. safeCall discards the original
    //     error completely; only the primitive `message` string survives.
    //
    // `state.collectionId` was narrowed to string by the early-return above,
    // but TypeScript drops the narrowing across the safeCall closure boundary
    // — hoist into a local to keep the type tight.
    const collectionId = state.collectionId;
    const prepped = await safeCall('prepare-image', () => prepareImageForRekognition(buffer));
    const faces = await safeCall('index-faces', () =>
      indexFaceForPhoto({
        collectionId,
        photoBytes: prepped,
        externalImageId: photoId,
      }),
    );

    return finalize({
      outcome: 'indexed' as const,
      faces: faces.map((f) => ({
        awsFaceId: f.awsFaceId,
        confidence: f.confidence,
        boundingBox: f.boundingBox,
      })),
    });
  });

  // ── 3. promote-upload-status ─────────────────────────────────────────
  // Skipped on rejection (step 2 already set upload_status='rejected').
  //
  // Owner-vs-guest discrimination:
  //   - Owner upload  → photos.user_id === events.user_id  AND
  //                     photos.guest_name IS NULL.
  //   - Guest upload  → either photos.user_id !== events.user_id
  //                     (organizer-contributor case where photo is owned
  //                     by the contributor), OR photos.guest_name is
  //                     populated (guest-collaborative case where photo's
  //                     user_id is the owner per `uploadGuestPhoto`).
  //
  // Owner uploads always approve. Non-owner uploads honor the event's
  // require_upload_approval flag — they stay 'pending' for the owner's
  // approval queue when the flag is set, approve otherwise.
  if (result.outcome !== 'rejected') {
    // step output: void (or undefined — no payload crosses this boundary)
    await loggedStepRun(step, 'promote-upload-status', photoId, async () => {
      const isOwnerUpload =
        ctx.photoUserId !== null &&
        ctx.eventOwnerId !== null &&
        ctx.photoUserId === ctx.eventOwnerId &&
        ctx.photoGuestName === null;
      if (isOwnerUpload) {
        await promoteToApproved(photoId);
        // Public event cache (events/[shareCode]) caches the approved-photo
        // list for 55 min. Without this nudge, newly-promoted photos stay
        // invisible to talents on the share-code page until the TTL elapses.
        await invalidateEventPhotoCache(eventId);
        return;
      }
      if (ctx.requireUploadApproval) {
        return; // stays 'pending' for owner approval queue
      }
      await promoteToApproved(photoId);
      await invalidateEventPhotoCache(eventId);
    });
  }

  // Rejected photos are done — step 2 cleaned up Storage and DB.
  if (result.outcome === 'rejected') {
    return { rejected: true, reason: result.reason };
  }

  // ── 4. persist-faces ─────────────────────────────────────────────────
  // Only when AWS returned face records. We carry just the metadata
  // (face id + confidence + bounding box) — no bytes — through this step.
  if (result.outcome === 'indexed' && result.faces.length > 0) {
    const collectionId = ctx.eventState?.collectionId;
    if (collectionId) {
      const faces = result.faces;
      // step output: void
      await loggedStepRun(step, 'persist-faces', photoId, async () => {
        for (const face of faces) {
          await addPhotoFace(adminClient, {
            photoId,
            awsFaceId: face.awsFaceId,
            awsCollectionId: collectionId,
            confidence: face.confidence,
            boundingBox: face.boundingBox,
          });
        }
      });
    }
  }

  // ── 5. mark-result ───────────────────────────────────────────────────
  // Terminal face_index_status. 'no-ai' branches collapse to 'not_applicable';
  // indexed branches split on whether AWS found any faces.
  // step output: void
  await loggedStepRun(step, 'mark-result', photoId, async () => {
    if (result.outcome === 'no-ai') {
      await updatePhotoFaceIndexStatus(adminClient, photoId, 'not_applicable');
      return;
    }
    // outcome === 'indexed'
    const facesLength = result.outcome === 'indexed' ? result.faces.length : 0;
    await updatePhotoFaceIndexStatus(
      adminClient,
      photoId,
      facesLength > 0 ? 'indexed' : 'no_faces',
    );
  });

  // ── 6. maybe-mark-event-ready ────────────────────────────────────────
  // Fan-out completion tracker. When no photos remain in 'pending' or
  // 'indexing' face_index_status, flip the event to 'ready' so the owner
  // sees the AI status card update.
  if (result.outcome === 'indexed') {
    // step output: void
    await loggedStepRun(step, 'maybe-mark-event-ready', photoId, async () => {
      const inFlight = await countEventPhotosInFlight(adminClient, eventId);
      if (inFlight === 0) {
        await updateEventRekognitionState(adminClient, eventId, { status: 'ready' });
      }
    });
  }

  return {
    outcome: result.outcome,
    facesIndexed: result.outcome === 'indexed' ? result.faces.length : 0,
  };
}
