/**
 * `photo.uploaded` worker: index a single photo's faces in AWS Rekognition.
 *
 * Flow:
 *   1. Re-check the event's AI state. If matching is now disabled or the
 *      event flipped to `contains_minors=true` since the upload, mark the
 *      photo `not_applicable` and stop.
 *   2. Mark the photo `indexing`.
 *   3. Download the photo bytes via service-role Supabase client.
 *   4. Run it through `prepareImageForRekognition` (Sharp).
 *   5. Call AWS `IndexFaces` with our `photoId` as `ExternalImageId`.
 *   6. Persist a row in `photo_faces` per detected face.
 *   7. Mark the photo `indexed` (if faces) or `no_faces` (if none).
 *   8. If no photos remain in `pending`/`indexing` for this event, flip
 *      `events.ai_matching_status` to `'ready'` — fan-out completion
 *      tracker without `step.waitForEvent`.
 *
 * Errors during any step are caught by Inngest's retry policy (3× with
 * exponential backoff). After the final retry, `onFailure` marks the
 * photo `failed` so the photographer can see it in the dashboard and
 * trigger a re-index.
 */

import {
  addPhotoFace,
  countEventPhotosInFlight,
  getEventRekognitionState,
  updateEventRekognitionState,
  updatePhotoFaceIndexStatus,
} from '@/database/queries/rekognition';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { indexFaceForPhoto } from '@/lib/aws/face-indexing';
import { prepareImageForRekognition } from '@/lib/aws/image-prep';
import { inngest } from '../client';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

interface PhotoUploadedPayload {
  photoId: string;
  eventId: string;
  storagePath: string;
}

export const indexPhotoFaces = inngest.createFunction(
  {
    id: 'index-photo-faces',
    // Per-event concurrency cap so a single 2000-photo bulk upload doesn't
    // drown out other events' work or hammer AWS in one shot.
    concurrency: [{ limit: 10, key: 'event.data.eventId' }],
    retries: 3,
    triggers: [{ event: 'photo.uploaded' }],
    onFailure: async ({ event }) => {
      const inner = (event.data as { event?: { data?: PhotoUploadedPayload } })?.event;
      const photoId = inner?.data?.photoId;
      if (!photoId) return;
      try {
        await updatePhotoFaceIndexStatus(adminClient, photoId, 'failed');
      } catch (err) {
        console.error('[index-photo-faces] failed to mark photo failed', err);
      }
    },
  },
  async ({ event, step }) => {
    const { photoId, eventId, storagePath } = event.data as PhotoUploadedPayload;

    const eventState = await step.run('check-event-state', async () => {
      return await getEventRekognitionState(adminClient, eventId);
    });

    if (
      !eventState ||
      !eventState.enabled ||
      eventState.containsMinors ||
      !eventState.collectionId
    ) {
      await step.run('mark-not-applicable', async () => {
        await updatePhotoFaceIndexStatus(adminClient, photoId, 'not_applicable');
      });
      return { skipped: true, reason: 'event-not-eligible' };
    }

    const collectionId = eventState.collectionId;

    await step.run('mark-indexing', async () => {
      await updatePhotoFaceIndexStatus(adminClient, photoId, 'indexing');
    });

    const photoBytesB64 = await step.run('download-bytes', async () => {
      const { data, error } = await supabaseAdmin.storage.from('photos').download(storagePath);
      if (error || !data) {
        throw new Error(`Failed to download photo ${storagePath}: ${error?.message ?? 'no data'}`);
      }
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    });

    const preppedBase64 = await step.run('prep-image', async () => {
      const buf = await prepareImageForRekognition(Buffer.from(photoBytesB64, 'base64'));
      return buf.toString('base64');
    });

    const faces = await step.run('index-faces', async () => {
      return await indexFaceForPhoto({
        collectionId,
        photoBytes: Buffer.from(preppedBase64, 'base64'),
        externalImageId: photoId,
      });
    });

    await step.run('persist-faces', async () => {
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

    await step.run('mark-result', async () => {
      await updatePhotoFaceIndexStatus(
        adminClient,
        photoId,
        faces.length > 0 ? 'indexed' : 'no_faces',
      );
    });

    await step.run('maybe-mark-event-ready', async () => {
      const inFlight = await countEventPhotosInFlight(adminClient, eventId);
      if (inFlight === 0) {
        await updateEventRekognitionState(adminClient, eventId, { status: 'ready' });
      }
    });

    return { indexedFaces: faces.length };
  },
);
