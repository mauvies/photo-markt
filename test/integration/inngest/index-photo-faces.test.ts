/**
 * Regression tests for the `photo.uploaded` Inngest worker.
 *
 * The bug this guards against:
 *   Before this fix, the worker checked AI-matching state FIRST and
 *   returned early when AI was disabled — without ever promoting
 *   `upload_status` to `'approved'`. Owner-uploaded photos on AI-disabled
 *   events therefore stayed at `'pending'` forever, invisible to the
 *   public gallery.
 *
 * The worker handler is invoked directly via `runIndexPhotoFacesFlow` with
 * a pass-through step substitute, so we don't need an Inngest runtime in
 * tests. The promotion step ordering is the load-bearing invariant.
 */

import { NonRetriableError } from 'inngest';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { indexFaceForPhotoMock, deleteFacesFromCollectionMock } = vi.hoisted(() => ({
  indexFaceForPhotoMock: vi.fn(),
  deleteFacesFromCollectionMock: vi.fn(),
}));
vi.mock('@/lib/aws/face-indexing', () => ({
  indexFaceForPhoto: indexFaceForPhotoMock,
  deleteFacesFromCollection: deleteFacesFromCollectionMock,
}));

import { updateEventRekognitionState } from '@/database/queries/rekognition';
import {
  type PhotoProcessedSender,
  type PhotoUploadStep,
  runIndexPhotoFacesFlow,
  settleStrandedUploadStatus,
} from '@/lib/inngest/functions/index-photo-faces';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/**
 * Pass-through step. `runIndexPhotoFacesFlow` wraps every side effect in
 * `step.run(name, fn)` to get Inngest's automatic retry boundaries; here
 * we just execute the function inline so the test runs synchronously.
 */
const passthroughStep: PhotoUploadStep = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

/** No-op sender — the flow now emits `photo.processed`; tests that don't care
 *  about it inject this so nothing hits the real Inngest client. */
const noopSend: PhotoProcessedSender = async () => undefined;

/** Recording sender for the emission tests. */
function recordingSend(): {
  send: PhotoProcessedSender;
  events: Array<{
    name: string;
    data: { photoId: string; eventId: string; storagePath: string; force?: boolean };
  }>;
} {
  const events: Array<{
    name: string;
    data: { photoId: string; eventId: string; storagePath: string; force?: boolean };
  }> = [];
  return {
    events,
    send: async (event) => {
      events.push(event);
      return undefined;
    },
  };
}

async function uploadJpeg(path: string, sb = createServiceClient()): Promise<number> {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#7788aa' },
  })
    .jpeg()
    .toBuffer();
  const { error } = await sb.storage
    .from('photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`uploadJpeg: ${error.message}`);
  return bytes.byteLength;
}

async function readPhoto(
  photoId: string,
): Promise<{ upload_status: string | null; face_index_status: string | null }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .select('upload_status, face_index_status')
    .eq('id', photoId)
    .single();
  if (error || !data) throw new Error(`readPhoto: ${error?.message ?? 'not found'}`);
  return data as { upload_status: string | null; face_index_status: string | null };
}

async function insertPhotoFace(args: {
  photoId: string;
  awsFaceId: string;
  awsCollectionId: string;
}): Promise<void> {
  const sb = createServiceClient();
  const { error } = await sb.from('photo_faces').insert({
    photo_id: args.photoId,
    aws_face_id: args.awsFaceId,
    aws_collection_id: args.awsCollectionId,
    confidence: 99,
  });
  if (error) throw new Error(`insertPhotoFace: ${error.message}`);
}

async function readPhotoFaceIds(photoId: string): Promise<string[]> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photo_faces')
    .select('aws_face_id')
    .eq('photo_id', photoId);
  if (error) throw new Error(`readPhotoFaceIds: ${error.message}`);
  return (data ?? []).map((row) => row.aws_face_id as string).sort();
}

async function insertPhoto(args: {
  userId: string;
  eventId: string;
  originalUrl: string;
  sizeBytes: number;
  uploadStatus: 'pending' | 'approved' | 'rejected' | 'failed';
  /** Set non-null to simulate a guest-collaborative upload. The worker uses
   *  this as a signal to discriminate non-owner uploads from owner uploads
   *  during the promote-upload-status step. */
  guestName?: string | null;
}): Promise<{ id: string }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      original_url: args.originalUrl,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      state: 'Catalonia',
      size_bytes: args.sizeBytes,
      upload_status: args.uploadStatus,
      guest_name: args.guestName ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPhoto: ${error?.message ?? 'no data'}`);
  return { id: data.id as string };
}

describe('runIndexPhotoFacesFlow — upload_status promotion', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    indexFaceForPhotoMock.mockReset();
    deleteFacesFromCollectionMock.mockReset();
  });

  it('promotes pending → approved when AI matching is DISABLED on the event', async () => {
    // Regression for the original bug. This test fails on the old worker
    // (AI-branch-before-promotion ordering) and passes on the new one.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/regression-ai-disabled.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);

    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const updated = await readPhoto(photo.id);
    expect(updated.upload_status).toBe('approved');
    // AI disabled → worker skips indexing entirely and the face row stays
    // at `not_applicable` (the event row may not have rekognition columns
    // populated on a fresh test event, which collapses into the same path).
    expect(updated.face_index_status).toBe('not_applicable');
  });

  it('keeps upload_status = pending for a GUEST upload when require_upload_approval is true', async () => {
    // Per the new owner-vs-guest semantics: owner uploads always approve,
    // even on require_upload_approval=true events. Only non-owner uploads
    // honor the approval queue. We simulate a guest-collaborative upload
    // by setting photos.guest_name — that's what `uploadGuestPhoto` does.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const sb = createServiceClient();
    const { error: updErr } = await sb
      .from('events')
      .update({ require_upload_approval: true, is_collaborative: true })
      .eq('id', event.id);
    if (updErr) throw new Error(updErr.message);

    const storagePath = `${owner.id}/${event.id}/regression-keep-pending.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
      guestName: 'Anonymous Contributor',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const updated = await readPhoto(photo.id);
    expect(updated.upload_status).toBe('pending');
  });

  it('OWNER uploads always promote to approved even when require_upload_approval is true', async () => {
    // Companion to the previous test: confirm owner uploads bypass the
    // approval queue. Same event setup, but no guest_name — the worker
    // should detect this as an owner upload and approve immediately.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const sb = createServiceClient();
    const { error: updErr } = await sb
      .from('events')
      .update({ require_upload_approval: true })
      .eq('id', event.id);
    if (updErr) throw new Error(updErr.message);

    const storagePath = `${owner.id}/${event.id}/owner-bypass-approval.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const updated = await readPhoto(photo.id);
    expect(updated.upload_status).toBe('approved');
  });

  it('never emits a Buffer or large payload from any step.run output', async () => {
    // Regression guard: the previous worker version returned base64-encoded
    // photo bytes from `download-bytes` and `prep-image` steps, blowing
    // past Inngest's ~4 MB step output cap and failing the whole function.
    // The rewrite keeps Buffers local to a single step closure; this test
    // intercepts every step.run return and asserts no payload contains a
    // Buffer or an oversized string.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/buffer-leak-guard.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    const outputs: Array<{ name: string; value: unknown }> = [];
    const spyingStep: PhotoUploadStep = {
      async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const value = await fn();
        outputs.push({ name, value });
        return value;
      },
    };

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      spyingStep,
      noopSend,
    );

    // 50 KB is well under Inngest's ~4 MB cap; even at this conservative
    // threshold our face-metadata payloads (tens of bytes) sail through.
    const MAX_PAYLOAD_BYTES = 50 * 1024;
    expect(outputs.length).toBeGreaterThan(0);
    for (const { name, value } of outputs) {
      expect(value, `step "${name}" return must not be a Buffer`).not.toBeInstanceOf(Buffer);
      if (typeof value === 'string') {
        expect(
          value.length,
          `step "${name}" string output must be < ${MAX_PAYLOAD_BYTES} bytes`,
        ).toBeLessThan(MAX_PAYLOAD_BYTES);
      }
      if (value && typeof value === 'object') {
        for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
          expect(
            fieldValue,
            `step "${name}" field "${key}" must not be a Buffer`,
          ).not.toBeInstanceOf(Buffer);
          if (typeof fieldValue === 'string') {
            expect(
              fieldValue.length,
              `step "${name}" field "${key}" must be < ${MAX_PAYLOAD_BYTES} bytes`,
            ).toBeLessThan(MAX_PAYLOAD_BYTES);
          }
        }
      }
    }
  });

  it('marks photo rejected and removes Storage object on invalid bytes', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/not-an-image.jpg`;
    const sb = createServiceClient();
    // SVG bytes with image/jpeg MIME — should fail magic-byte validation.
    const garbage = Buffer.from('<svg onload="alert(1)"></svg>', 'utf8');
    const { error: upErr } = await sb.storage
      .from('photos')
      .upload(storagePath, garbage, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw new Error(upErr.message);

    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes: garbage.byteLength,
      uploadStatus: 'pending',
    });

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    const updated = await readPhoto(photo.id);
    expect(updated.upload_status).toBe('rejected');
    expect(updated.face_index_status).toBe('not_applicable');

    // Storage object removed.
    const { data: existing } = await sb.storage
      .from('photos')
      .list(`${owner.id}/${event.id}/`, { limit: 1000 });
    expect(existing?.some((o) => o.name === 'not-an-image.jpg')).toBe(false);
  });

  // T-068: thumbnails are chained after indexing. A non-rejected photo must
  // emit `photo.processed` (carrying the same payload) so the thumbnail worker
  // can bake with face boxes available. Fails before the emit step existed.
  it('emits photo.processed after a non-rejected outcome', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/emits-processed.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    const rec = recordingSend();
    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      rec.send,
    );

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0].name).toBe('photo.processed');
    // No AI on this event → no faces indexed → force:false so the thumbnail
    // ready-guard (T-092) can skip a bare re-emission over a ready thumbnail.
    expect(rec.events[0].data).toEqual({
      photoId: photo.id,
      eventId: event.id,
      storagePath,
      force: false,
    });
  });

  it('does NOT emit photo.processed for a rejected photo', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/rejected-no-emit.jpg`;
    const sb = createServiceClient();
    const garbage = Buffer.from('<svg onload="alert(1)"></svg>', 'utf8');
    const { error: upErr } = await sb.storage
      .from('photos')
      .upload(storagePath, garbage, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw new Error(upErr.message);

    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes: garbage.byteLength,
      uploadStatus: 'pending',
    });

    const rec = recordingSend();
    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      rec.send,
    );

    expect(rec.events).toHaveLength(0);
  });

  // T-071 regression: a storage object that will never exist (the classic
  // local-dev symptom — env mismatch between where the photo was uploaded and
  // where this worker runs) must fail FAST via NonRetriableError, not retry
  // 3x for nothing. Fails before the fix (plain Error, retries pointlessly).
  it('throws NonRetriableError for a missing storage object (never retries)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    // Insert a photo row whose storage object was never uploaded.
    const storagePath = `${owner.id}/${event.id}/never-uploaded.jpg`;
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes: 1234,
      uploadStatus: 'pending',
    });

    await expect(
      runIndexPhotoFacesFlow(
        { photoId: photo.id, eventId: event.id, storagePath },
        passthroughStep,
        noopSend,
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});

// T-091 regression: re-indexing a photo that already has persisted faces
// (a prior partial run, or the "Re-index event" backfill re-emitting
// photo.uploaded) must not accumulate rows in photo_faces or orphan faces
// in the AWS collection forever. Fails before the fix (old + new face rows
// both present); passes after (stale row replaced by the new one).
describe('runIndexPhotoFacesFlow — stale face cleanup on re-index (T-091)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    indexFaceForPhotoMock.mockReset();
    deleteFacesFromCollectionMock.mockReset();
  });

  async function setupAiEnabledEvent(): Promise<{
    owner: { id: string };
    event: { id: string };
    collectionId: string;
  }> {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const collectionId = `test-collection-${event.id}`;
    await updateEventRekognitionState(createServiceClient(), event.id, {
      enabled: true,
      collectionId,
      region: 'eu-west-1',
      status: 'indexing',
    });
    return { owner, event, collectionId };
  }

  it('deletes stale AWS faces + photo_faces rows before re-indexing (no accumulation)', async () => {
    const { owner, event, collectionId } = await setupAiEnabledEvent();

    const storagePath = `${owner.id}/${event.id}/reindex-cleanup.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    // Simulate a prior run that already persisted a face for this photo.
    await insertPhotoFace({
      photoId: photo.id,
      awsFaceId: 'old-face-1',
      awsCollectionId: collectionId,
    });

    indexFaceForPhotoMock.mockResolvedValue([
      { awsFaceId: 'new-face-1', confidence: 99, boundingBox: null },
    ]);
    deleteFacesFromCollectionMock.mockResolvedValue(undefined);

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    expect(deleteFacesFromCollectionMock).toHaveBeenCalledWith({
      collectionId,
      faceIds: ['old-face-1'],
    });
    // Exactly the new set — no accumulation of the stale row.
    expect(await readPhotoFaceIds(photo.id)).toEqual(['new-face-1']);
  });

  it('still replaces stale faces even when the AWS DeleteFaces call fails (best-effort)', async () => {
    const { owner, event, collectionId } = await setupAiEnabledEvent();

    const storagePath = `${owner.id}/${event.id}/reindex-cleanup-aws-fails.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    await insertPhotoFace({
      photoId: photo.id,
      awsFaceId: 'old-face-2',
      awsCollectionId: collectionId,
    });

    indexFaceForPhotoMock.mockResolvedValue([
      { awsFaceId: 'new-face-2', confidence: 99, boundingBox: null },
    ]);
    deleteFacesFromCollectionMock.mockRejectedValue(new Error('AWS throttled'));

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    // The AWS delete failed but the re-index must still complete and the
    // stale DB row must still be gone (never blocks / never leaves it behind).
    expect(await readPhotoFaceIds(photo.id)).toEqual(['new-face-2']);
    const updated = await readPhoto(photo.id);
    expect(updated.face_index_status).toBe('indexed');
  });

  it('does not call DeleteFaces when the photo has no prior faces (first index)', async () => {
    const { owner, event } = await setupAiEnabledEvent();

    const storagePath = `${owner.id}/${event.id}/first-index.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'pending',
    });

    indexFaceForPhotoMock.mockResolvedValue([
      { awsFaceId: 'first-face-1', confidence: 99, boundingBox: null },
    ]);

    await runIndexPhotoFacesFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
      noopSend,
    );

    expect(deleteFacesFromCollectionMock).not.toHaveBeenCalled();
    expect(await readPhotoFaceIds(photo.id)).toEqual(['first-face-1']);
  });

  // T-092: when a run actually indexes faces, the emitted photo.processed must
  // carry force:true so the thumbnail worker re-bakes even an already-`ready`
  // thumbnail — the T-078 scenario (AI enabled after upload → blur must appear)
  // depends on this. A no-face run must carry force:false.
  it('emits photo.processed with force:true when faces were indexed (false when none)', async () => {
    const { owner, event } = await setupAiEnabledEvent();

    // Photo that indexes a face → force:true.
    const facePath = `${owner.id}/${event.id}/force-with-face.jpg`;
    const faceSize = await uploadJpeg(facePath);
    const facePhoto = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: facePath,
      sizeBytes: faceSize,
      uploadStatus: 'pending',
    });
    indexFaceForPhotoMock.mockResolvedValueOnce([
      { awsFaceId: 'force-face-1', confidence: 99, boundingBox: null },
    ]);

    const recWithFace = recordingSend();
    await runIndexPhotoFacesFlow(
      { photoId: facePhoto.id, eventId: event.id, storagePath: facePath },
      passthroughStep,
      recWithFace.send,
    );
    expect(recWithFace.events).toHaveLength(1);
    expect(recWithFace.events[0].data.force).toBe(true);

    // Photo that indexes zero faces → force:false (no blur, nothing changed).
    const plainPath = `${owner.id}/${event.id}/force-no-face.jpg`;
    const plainSize = await uploadJpeg(plainPath);
    const plainPhoto = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: plainPath,
      sizeBytes: plainSize,
      uploadStatus: 'pending',
    });
    indexFaceForPhotoMock.mockResolvedValueOnce([]);

    const recNoFace = recordingSend();
    await runIndexPhotoFacesFlow(
      { photoId: plainPhoto.id, eventId: event.id, storagePath: plainPath },
      passthroughStep,
      recNoFace.send,
    );
    expect(recNoFace.events).toHaveLength(1);
    expect(recNoFace.events[0].data.force).toBe(false);
  });
});

/**
 * T-231: what `onFailure` does with a run that died BEFORE the promotion step.
 *
 * Such a run never settled `upload_status`, so before this the row stayed
 * `pending` forever — invisible on the approved-only galleries, absent from the
 * owner's Pending tab, and re-driven by the reconcile cron every 30 minutes
 * with no possible outcome. `settleStrandedUploadStatus` is the terminal state
 * that ends that; these tests pin both the settling and its two no-ops.
 */
describe('settleStrandedUploadStatus — T-231 terminal state', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
  });

  it('settles a stranded OWNER upload to failed', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: `${owner.id}/${event.id}/stranded.jpg`,
      sizeBytes: 1024,
      uploadStatus: 'pending',
    });

    expect(await settleStrandedUploadStatus(photo.id, event.id)).toBe('settled');
    expect((await readPhoto(photo.id)).upload_status).toBe('failed');
  });

  it('settles a stranded third-party upload when the event does NOT moderate', async () => {
    // No approval queue on this event, so the worker would have approved it —
    // `pending` here is a stranded run, not a legitimate wait.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: `${owner.id}/${event.id}/stranded-guest.jpg`,
      sizeBytes: 1024,
      uploadStatus: 'pending',
      guestName: 'Anonymous Contributor',
    });

    expect(await settleStrandedUploadStatus(photo.id, event.id)).toBe('settled');
    expect((await readPhoto(photo.id)).upload_status).toBe('failed');
  });

  it('leaves a third-party upload alone when it is the legitimate moderation queue', async () => {
    // Here `pending` IS a real state the owner can see and act on in the
    // Pending tab. Stealing it into `failed` would empty the moderation queue.
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const sb = createServiceClient();
    const { error } = await sb
      .from('events')
      .update({ require_upload_approval: true, is_collaborative: true })
      .eq('id', event.id);
    if (error) throw new Error(error.message);

    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: `${owner.id}/${event.id}/queued-guest.jpg`,
      sizeBytes: 1024,
      uploadStatus: 'pending',
      guestName: 'Anonymous Contributor',
    });

    expect(await settleStrandedUploadStatus(photo.id, event.id)).toBe('moderation-queue');
    expect((await readPhoto(photo.id)).upload_status).toBe('pending');
  });

  it('never degrades an already-approved photo (a late step 4–7 failure)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: `${owner.id}/${event.id}/already-live.jpg`,
      sizeBytes: 1024,
      uploadStatus: 'approved',
    });

    expect(await settleStrandedUploadStatus(photo.id, event.id)).toBe('not-pending');
    expect((await readPhoto(photo.id)).upload_status).toBe('approved');
  });

  it('is a no-op for a photo row that no longer exists', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    expect(await settleStrandedUploadStatus(crypto.randomUUID(), event.id)).toBe('unknown-row');
  });
});
