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

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface EventBibDetectionEnabledPayload {
  eventId: string;
  userId: string;
}

export const backfillEventBibDetection = inngest.createFunction(
  {
    id: 'backfill-event-bib-detection',
    retries: 3,
    triggers: [{ event: 'event.bib-detection-enabled' }],
  },
  async ({ event, step }) => {
    const { eventId } = event.data as EventBibDetectionEnabledPayload;

    const state = await step.run('load-event', async () => {
      return await getEventBibDetectionState(adminClient, eventId);
    });

    if (!state || !state.enabled || state.containsMinors) {
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
        await inngest.send(events);
      }
    });

    return { processed: photos.length };
  },
);
