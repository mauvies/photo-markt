/**
 * `photo.uploaded` / `photo.bib-detect` worker: when bib detection is enabled
 * on a photo's event, read its race bib numbers with AWS Rekognition DetectText
 * and persist them. Runs independently of, and in parallel with, the face
 * indexing and thumbnail jobs.
 *
 * Byte-safety mirrors index-photo-faces: the download + DetectText happen
 * inside ONE step ("detect-bibs") and only a small JSON ({ outcome, bibs? })
 * crosses any step boundary — image bytes never enter Inngest step output.
 * Every AWS/Storage/Sharp call is wrapped in `safeCall`.
 *
 * Triggers:
 *   - `photo.uploaded`   — every new upload (no-ops unless the event opted in).
 *   - `photo.bib-detect` — the backfill fan-out (only this worker consumes it,
 *                          so re-detecting an event never re-runs face/thumbnail
 *                          jobs).
 */

import { NonRetriableError } from 'inngest';
import {
  countEventPhotosBibInFlight,
  getEventBibDetectionState,
  getPhotoBibDetectionStatus,
  type PhotoBibInput,
  persistPhotoBibs,
  updateEventBibDetectionState,
  updatePhotoBibDetectionStatus,
} from '@/database/queries/bib-numbers';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { detectTextForPhoto } from '@/lib/aws/bib-detection';
import { prepareImageForRekognition } from '@/lib/aws/image-prep';
import { extractBibCandidates } from '@/lib/bib-numbers';
import { safeCall } from '@/lib/safe-call';
import { isStorageObjectNotFound } from '@/lib/storage-object-not-found';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

export interface BibDetectPayload {
  photoId: string;
  eventId: string;
  storagePath: string;
}

/** Narrow `step.run` surface — lets the integration test substitute a fake. */
export interface BibDetectStep {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

type BibOutcome =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'no-bibs' }
  | { outcome: 'detected'; bibs: PhotoBibInput[] };

export const detectPhotoBibs = inngest.createFunction(
  {
    id: 'detect-photo-bibs',
    // Per-event concurrency cap, matching index-photo-faces, so one bulk
    // upload doesn't hammer DetectText all at once.
    concurrency: [{ limit: 5, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'photo.uploaded' }, { event: 'photo.bib-detect' }],
    onFailure: async ({ event }) => {
      const inner = (event.data as { event?: { data?: BibDetectPayload } })?.event;
      const photoId = inner?.data?.photoId;
      if (!photoId) return;
      try {
        await updatePhotoBibDetectionStatus(adminClient, photoId, 'failed');
      } catch (err) {
        console.error('[detect-photo-bibs] onFailure cleanup failed', err);
      }
    },
  },
  async ({ event, step }) => {
    return await runDetectPhotoBibsFlow(
      event.data as BibDetectPayload,
      step as unknown as BibDetectStep,
      event.name,
    );
  },
);

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step).
 *
 * `eventName` distinguishes the two triggers: `photo.uploaded` re-fires for
 * reasons that have nothing to do with bibs (e.g. a face-indexing re-index
 * backfill resets `face_index_status` and replays this event), so a photo
 * already `detected`/`no_bibs` is skipped — no download, no `DetectText`.
 * `photo.bib-detect` is the dorsal backfill's own explicit re-detection
 * event; it already filters to null/`failed` photos before sending
 * (`backfill-event-bib-detection.ts`), so it always runs.
 */
export async function runDetectPhotoBibsFlow(
  payload: BibDetectPayload,
  step: BibDetectStep,
  eventName = 'photo.uploaded',
): Promise<unknown> {
  const { photoId, eventId, storagePath } = payload;

  // 1. Gate on the per-event opt-in. Disabled (or minors-flagged, for parity
  //    with face matching) → leave bib_detection_status NULL ("not run") and
  //    make no AWS call. No DB write so non-opted-in uploads cost nothing.
  const state = await step.run('check-bib-state', async () => {
    return await getEventBibDetectionState(adminClient, eventId);
  });
  if (!state || !state.enabled || state.containsMinors) {
    return { skipped: true, reason: 'not-enabled' };
  }

  // 1b. Gate on the per-photo status — only for photo.uploaded. A photo whose
  //     bibs were already resolved must not re-pay DetectText just because an
  //     unrelated re-index replayed this event (F-12).
  if (eventName === 'photo.uploaded') {
    const photoStatus = await step.run('check-photo-status', async () => {
      return await getPhotoBibDetectionStatus(adminClient, photoId);
    });
    if (photoStatus === 'detected' || photoStatus === 'no_bibs') {
      return { skipped: true, reason: 'already-detected' };
    }
  }

  // 2. The mega-step: download + DetectText + filter, all bytes stack-local.
  const result: BibOutcome = await step.run('detect-bibs', async () => {
    const { data, error } = await safeCall('storage-download', () =>
      supabaseAdmin.storage.from('photos').download(storagePath),
    );
    if (error || !data) {
      const message = `Failed to download photo ${storagePath}: ${error?.message ?? 'no data'}`;
      // Definitive — retrying won't make the object appear (see T-071: the
      // classic local-dev cause is an env mismatch between where the photo was
      // uploaded and where this worker actually runs).
      if (isStorageObjectNotFound(error)) throw new NonRetriableError(message);
      throw new Error(message);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const prepped = await safeCall('prepare-image', () => prepareImageForRekognition(buffer));
    const detections = await safeCall('detect-text', () =>
      detectTextForPhoto({ photoBytes: prepped }),
    );
    const bibs = extractBibCandidates(detections);
    if (bibs.length === 0) return { outcome: 'no-bibs' as const };
    return {
      outcome: 'detected' as const,
      bibs: bibs.map((b) => ({
        bibText: b.text,
        confidence: b.confidence,
        boundingBox: b.boundingBox,
      })),
    };
  });

  // 3. Persist (only when there's something to store).
  if (result.outcome === 'detected') {
    const bibs = result.bibs;
    await step.run('persist-bibs', async () => {
      await persistPhotoBibs(adminClient, photoId, bibs);
    });
  }

  // 4. Terminal per-photo status.
  await step.run('mark-bib-result', async () => {
    await updatePhotoBibDetectionStatus(
      adminClient,
      photoId,
      result.outcome === 'detected' ? 'detected' : 'no_bibs',
    );
  });

  // 5. Fan-out completion tracker: flip the event to 'ready' once nothing is
  //    pending/detecting (mirrors index-photo-faces' maybe-mark-event-ready).
  await step.run('maybe-mark-event-ready', async () => {
    const inFlight = await countEventPhotosBibInFlight(adminClient, eventId);
    if (inFlight === 0) {
      await updateEventBibDetectionState(adminClient, eventId, { status: 'ready' });
    }
  });

  return {
    outcome: result.outcome,
    bibsDetected: result.outcome === 'detected' ? result.bibs.length : 0,
  };
}
