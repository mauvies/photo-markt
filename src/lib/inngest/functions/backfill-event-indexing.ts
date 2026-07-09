/**
 * `event.ai-matching-enabled` worker: bootstrap or rebuild an event's
 * Rekognition collection.
 *
 * Fired by:
 *   - Enabling AI matching from the event edit form / event creation.
 *   - The "Re-index event" button on the event detail page.
 *
 * Flow:
 *   1. Re-load the event; verify it's still eligible (enabled + not minors).
 *   2. Compute the per-event collection id and create it in AWS (idempotent).
 *   3. Persist `rekognition_collection_id`, `rekognition_region`, and flip
 *      `ai_matching_status` to `'indexing'`.
 *   4. List photos in non-success states (`pending`, `failed`, `not_applicable`,
 *      `indexing`) — these are the ones that need to be (re-)indexed.
 *   5. Reset them to `pending`.
 *   6. Fan out one `photo.uploaded` event per photo. Inngest's per-event
 *      concurrency caps how many run at once. The per-photo function will
 *      eventually flip `ai_matching_status` to `'ready'` when the last
 *      photo drains.
 */

import {
  bulkSetPhotoFaceIndexStatus,
  getEventRekognitionState,
  listEventPhotosByStatuses,
  updateEventRekognitionState,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { env } from '@/env.mjs';
import { buildCollectionId } from '@/lib/aws/collection-naming';
import { createCollection } from '@/lib/aws/face-indexing';
import { inngest } from '../client';
import type { InngestStepRunner } from '../step';
import { BACKFILL_DEBOUNCE_PERIOD } from './backfill-config';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

export interface EventAiMatchingEnabledPayload {
  eventId: string;
  userId: string;
}

/**
 * Narrow sender for the per-photo `photo.uploaded` fan-out. Injected (defaults
 * to `inngest.send`) so integration tests can spy on the fan-out without an
 * Inngest runtime.
 */
export type PhotoUploadedFanoutSender = (
  events: Array<{
    name: 'photo.uploaded';
    data: { photoId: string; eventId: string; storagePath: string };
  }>,
) => Promise<unknown>;

const defaultFanoutSender: PhotoUploadedFanoutSender = (events) => inngest.send(events);

export const backfillEventIndexing = inngest.createFunction(
  {
    id: 'backfill-event-indexing',
    // De-dupe rapid duplicate triggers for the same event (a double-click on
    // "Re-index event", a double-submitted create/edit, enable-AI immediately
    // followed by re-index). Without this, each trigger runs a full re-index
    // pass that fans out `photo.uploaded` for every photo → duplicated AWS
    // IndexFaces spend + duplicate faces (T-089, aggravating T-091).
    //
    // `debounce` (not an event-`id` idempotency key) is the right tool: it is
    // a *sliding* window that reschedules on each new trigger and runs once
    // after the quiet period, so it collapses rapid clicks WITHOUT the 24h
    // dedup memory of an event id (which would silently drop a legitimate
    // re-index — or a disable→re-enable — that reused the same key). A
    // deliberate re-index after the window runs normally.
    debounce: { key: 'event.data.eventId', period: BACKFILL_DEBOUNCE_PERIOD },
    // Backstop: serialize any runs that do overlap (e.g. a re-index fired
    // while an earlier, longer backfill is still draining) so they never
    // index the same photos in parallel.
    concurrency: [{ limit: 1, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'event.ai-matching-enabled' }],
  },
  async ({ event, step }) => {
    return await runBackfillEventIndexingFlow(
      event.data as EventAiMatchingEnabledPayload,
      step as unknown as InngestStepRunner,
    );
  },
);

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step and a spy sender).
 */
export async function runBackfillEventIndexingFlow(
  payload: EventAiMatchingEnabledPayload,
  step: InngestStepRunner,
  send: PhotoUploadedFanoutSender = defaultFanoutSender,
): Promise<unknown> {
  const { eventId } = payload;

  const state = await step.run('load-event', async () => {
    return await getEventRekognitionState(adminClient, eventId);
  });

  if (!state || !state.enabled || state.containsMinors) {
    return { skipped: true, reason: 'event-not-eligible' };
  }

  const collectionId = state.collectionId ?? buildCollectionId(eventId);

  await step.run('create-collection', async () => {
    await createCollection(collectionId);
  });

  await step.run('persist-collection', async () => {
    await updateEventRekognitionState(adminClient, eventId, {
      collectionId,
      region: env.AWS_REGION,
      status: 'indexing',
    });
  });

  // step output: Array<{id, storagePath}>. <800 KB at the per-event cap
  // (5000 photos × ~150 B each). Well under Inngest's ~4 MB step-output
  // limit. If MAX_PHOTOS_PER_EVENT ever raises beyond ~25 000, paginate
  // or collapse list+reset+fanout into a single mega-step.
  const photos = await step.run('list-photos-to-process', async () => {
    return await listEventPhotosByStatuses(adminClient, eventId, [
      'pending',
      'failed',
      'not_applicable',
      'indexing',
    ]);
  });

  if (photos.length === 0) {
    await step.run('mark-event-ready', async () => {
      await updateEventRekognitionState(adminClient, eventId, { status: 'ready' });
    });
    return { processed: 0 };
  }

  await step.run('reset-photo-statuses', async () => {
    await bulkSetPhotoFaceIndexStatus(
      adminClient,
      photos.map((p) => p.id),
      'pending',
    );
  });

  await step.run('fanout', async () => {
    const events = photos
      .filter((p): p is { id: string; storagePath: string } => p.storagePath !== null)
      .map((p) => ({
        name: 'photo.uploaded' as const,
        data: {
          photoId: p.id,
          eventId,
          storagePath: p.storagePath,
        },
      }));
    if (events.length > 0) {
      await send(events);
    }
  });

  return { processed: photos.length };
}
