/**
 * `event.bib-detection-enabled` worker: when a photographer enables bib
 * detection on an event that already has photos, fan detection out over the
 * existing photos.
 *
 * Flow (mirrors backfill-event-indexing):
 *   1. Re-load the event's bib state; verify it's still eligible.
 *   2. Flip the event status to 'detecting'.
 *   3. List photos that still need detection (never run / failed).
 *   4. Reset them to 'pending'.
 *   5. Fan out one `photo.bib-detect` event per photo — a bib-specific event so
 *      the backfill never re-runs the face / thumbnail jobs. The per-photo
 *      worker flips the event status to 'ready' when the last photo drains.
 */

import {
  bulkSetPhotoBibDetectionStatus,
  getEventBibDetectionState,
  listEventPhotosForBibDetection,
  updateEventBibDetectionState,
} from '@/database/queries/bib-numbers';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '../client';
import type { InngestStepRunner } from '../step';
import { BACKFILL_DEBOUNCE_PERIOD } from './backfill-config';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

export interface EventBibDetectionEnabledPayload {
  eventId: string;
  userId: string;
}

/**
 * Narrow sender for the per-photo `photo.bib-detect` fan-out. Injected
 * (defaults to `inngest.send`) so integration tests can spy on the fan-out
 * without an Inngest runtime.
 */
export type PhotoBibDetectFanoutSender = (
  events: Array<{
    name: 'photo.bib-detect';
    data: { photoId: string; eventId: string; storagePath: string };
  }>,
) => Promise<unknown>;

const defaultFanoutSender: PhotoBibDetectFanoutSender = (events) => inngest.send(events);

export const backfillEventBibDetection = inngest.createFunction(
  {
    id: 'backfill-event-bib-detection',
    // De-dupe rapid duplicate enables for the same event (double-click /
    // double-submit / enable → re-enable) into a single run. Without this,
    // each trigger fans out `photo.bib-detect` for every photo → double-paid
    // AWS DetectText (T-089). `debounce` is a sliding window — it collapses
    // rapid triggers without the 24h dedup memory of an event id (which would
    // silently drop a legitimate later re-enable that reused the same key).
    debounce: { key: 'event.data.eventId', period: BACKFILL_DEBOUNCE_PERIOD },
    // Backstop: serialize any runs that still overlap so they never fan out
    // over the same photos in parallel.
    concurrency: [{ limit: 1, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'event.bib-detection-enabled' }],
  },
  async ({ event, step }) => {
    return await runBackfillEventBibDetectionFlow(
      event.data as EventBibDetectionEnabledPayload,
      step as unknown as InngestStepRunner,
    );
  },
);

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step and a spy sender).
 */
export async function runBackfillEventBibDetectionFlow(
  payload: EventBibDetectionEnabledPayload,
  step: InngestStepRunner,
  send: PhotoBibDetectFanoutSender = defaultFanoutSender,
): Promise<unknown> {
  const { eventId } = payload;

  const state = await step.run('load-event', async () => {
    return await getEventBibDetectionState(adminClient, eventId);
  });

  if (!state?.enabled || state.containsMinors) {
    return { skipped: true, reason: 'event-not-eligible' };
  }

  await step.run('mark-detecting', async () => {
    await updateEventBibDetectionState(adminClient, eventId, { status: 'detecting' });
  });

  const photos = await step.run('list-photos-to-process', async () => {
    return await listEventPhotosForBibDetection(adminClient, eventId);
  });

  if (photos.length === 0) {
    await step.run('mark-event-ready', async () => {
      await updateEventBibDetectionState(adminClient, eventId, { status: 'ready' });
    });
    return { processed: 0 };
  }

  await step.run('reset-photo-statuses', async () => {
    await bulkSetPhotoBibDetectionStatus(
      adminClient,
      photos.map((p) => p.id),
      'pending',
    );
  });

  await step.run('fanout', async () => {
    const events = photos
      .filter((p): p is { id: string; storagePath: string } => p.storagePath !== null)
      .map((p) => ({
        name: 'photo.bib-detect' as const,
        data: { photoId: p.id, eventId, storagePath: p.storagePath },
      }));
    if (events.length > 0) {
      await send(events);
    }
  });

  return { processed: photos.length };
}
