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

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface EventAiMatchingEnabledPayload {
  eventId: string;
  userId: string;
}

export const backfillEventIndexing = inngest.createFunction(
  {
    id: 'backfill-event-indexing',
    retries: 3,
    triggers: [{ event: 'event.ai-matching-enabled' }],
  },
  async ({ event, step }) => {
    const { eventId } = event.data as EventAiMatchingEnabledPayload;

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
        await inngest.send(events);
      }
    });

    return { processed: photos.length };
  },
);
