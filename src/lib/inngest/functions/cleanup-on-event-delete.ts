/**
 * `event.deleted` worker: clean up AWS state after a photographer deletes
 * an event.
 *
 * The event row itself is soft-deleted by the server action (`deleted_at`
 * set). `photo_faces` rows cascade only on `photos.id` deletes, not on
 * `events.deleted_at`. So even after soft-delete, faces stay until photos
 * are physically removed. What this function takes care of is the AWS
 * side: drop the collection so AWS isn't charging us for storage of an
 * event no one will ever search.
 */

import { updateEventRekognitionState } from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { deleteCollection } from '@/lib/aws/face-indexing';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface EventDeletedPayload {
  eventId: string;
}

export const cleanupOnEventDelete = inngest.createFunction(
  {
    id: 'cleanup-on-event-delete',
    retries: 3,
    triggers: [{ event: 'event.deleted' }],
  },
  async ({ event, step }) => {
    const { eventId } = event.data as EventDeletedPayload;

    // The event is soft-deleted, but the row still exists with its
    // `rekognition_collection_id` populated. Read it directly via the
    // admin client (`getEventRekognitionState` filters out soft-deleted).
    const collectionId = await step.run('load-collection-id', async () => {
      const { data } = await supabaseAdmin
        .from('events')
        .select('rekognition_collection_id')
        .eq('id', eventId)
        .maybeSingle();
      return (data?.rekognition_collection_id as string | null) ?? null;
    });

    if (collectionId) {
      await step.run('delete-aws-collection', async () => {
        await deleteCollection(collectionId);
      });
      await step.run('clear-collection-id', async () => {
        await updateEventRekognitionState(adminClient, eventId, {
          collectionId: null,
          region: null,
          status: 'idle',
        });
      });
    }

    return { eventId };
  },
);
