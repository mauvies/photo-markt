/**
 * `event.ai-matching-disabled` worker: tear down an event's AI matching.
 *
 * Flow:
 *   1. Load the event. If it never had a collection, just zero the AI
 *      columns and mark photos `not_applicable` — no AWS call needed.
 *   2. Delete the AWS collection (idempotent — `ResourceNotFoundException`
 *      is swallowed).
 *   3. Delete all `photo_faces` rows for the event.
 *   4. Reset event columns: `ai_matching_status='idle'`, collection id and
 *      region nulled out.
 *   5. Flip every event photo's `face_index_status` to `not_applicable`.
 *
 * This function does NOT toggle `ai_matching_enabled` itself — the server
 * action does that before emitting the event. Keeps the worker idempotent
 * if it's retried.
 */

import {
  bulkSetPhotoFaceIndexStatus,
  deletePhotoFacesByEventId,
  getEventRekognitionState,
  listEventPhotoIds,
  updateEventRekognitionState,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { deleteCollection } from '@/lib/aws/face-indexing';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface EventAiMatchingDisabledPayload {
  eventId: string;
}

export const disableEventIndexing = inngest.createFunction(
  {
    id: 'disable-event-indexing',
    retries: 3,
    triggers: [{ event: 'event.ai-matching-disabled' }],
  },
  async ({ event, step }) => {
    const { eventId } = event.data as EventAiMatchingDisabledPayload;

    const state = await step.run('load-event', async () => {
      return await getEventRekognitionState(adminClient, eventId);
    });

    if (state?.collectionId) {
      await step.run('delete-aws-collection', async () => {
        await deleteCollection(state.collectionId as string);
      });
    }

    await step.run('delete-photo-faces', async () => {
      await deletePhotoFacesByEventId(adminClient, eventId);
    });

    await step.run('reset-event', async () => {
      await updateEventRekognitionState(adminClient, eventId, {
        status: 'idle',
        collectionId: null,
        region: null,
      });
    });

    await step.run('mark-photos-not-applicable', async () => {
      const ids = await listEventPhotoIds(adminClient, eventId);
      if (ids.length === 0) return;
      await bulkSetPhotoFaceIndexStatus(adminClient, ids, 'not_applicable');
    });

    return { eventId };
  },
);
