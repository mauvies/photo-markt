/**
 * T-099: reconciliation cron for wedged AI face-indexing states.
 *
 * The flow body `runReconcileIndexingFlow` is invoked directly with a
 * pass-through step, an explicit `nowMs` (so the 1-hour staleness window is
 * deterministic — a FUTURE `nowMs` makes freshly-created rows "stale", real-now
 * keeps them fresh), and a spy sender (no Inngest runtime). Every DB side effect
 * hits the local Supabase stack.
 *
 * Covers the three wedge modes and, critically, the freshness guard that keeps
 * the sweep from clobbering in-flight work.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { type AiMatchingStatus, updateEventRekognitionState } from '@/database/queries/rekognition';
import {
  type ReconcileFanoutSender,
  reconcileIndexingState,
  runReconcileIndexingFlow,
} from '@/lib/inngest/functions/reconcile-indexing';
import type { InngestStepRunner } from '@/lib/inngest/step';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const HOUR_MS = 60 * 60 * 1000;
/** A `nowMs` two hours ahead makes anything created "now" older than the 1h window. */
const FUTURE_NOW = Date.now() + 2 * HOUR_MS;

const passthroughStep: InngestStepRunner = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

type SentEvent =
  | { name: 'photo.uploaded'; data: { photoId: string; eventId: string; storagePath: string } }
  | {
      name: 'photo.processed';
      data: { photoId: string; eventId: string; storagePath: string; force: boolean };
    };

function recordingSender(): { send: ReconcileFanoutSender; sent: SentEvent[] } {
  const sent: SentEvent[] = [];
  return {
    sent,
    send: async (events) => {
      sent.push(...(events as SentEvent[]));
      return undefined;
    },
  };
}

async function setAiStatus(eventId: string, status: AiMatchingStatus): Promise<void> {
  await updateEventRekognitionState(createServiceClient(), eventId, { status });
}

async function setFaceStatus(photoId: string, status: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('photos')
    .update({ face_index_status: status })
    .eq('id', photoId);
  if (error) throw new Error(`setFaceStatus: ${error.message}`);
}

async function setThumbStatus(photoId: string, status: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('photos')
    .update({ thumbnail_status: status })
    .eq('id', photoId);
  if (error) throw new Error(`setThumbStatus: ${error.message}`);
}

async function setUploadStatus(photoId: string, status: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('photos')
    .update({ upload_status: status })
    .eq('id', photoId);
  if (error) throw new Error(`setUploadStatus: ${error.message}`);
}

/** Insert a photo attributed to a non-owner (authenticated contributor). */
async function createContributorPhoto(
  eventId: string,
  contributorId: string,
): Promise<{ id: string }> {
  const sb = createServiceClient();
  const suffix = crypto.randomUUID();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: contributorId,
      event_id: eventId,
      original_url: `${contributorId}/${eventId}/${suffix}.jpg`,
      taken_at: new Date().toISOString(),
      city: 'Barcelona',
      country: 'ES',
      uploaded_by: contributorId,
      upload_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createContributorPhoto: ${error?.message ?? 'no data'}`);
  return { id: data.id as string };
}

async function readUploadStatus(photoId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('upload_status')
    .eq('id', photoId)
    .single();
  return (data?.upload_status as string | null) ?? null;
}

async function readAiStatus(eventId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('events')
    .select('ai_matching_status')
    .eq('id', eventId)
    .single();
  return (data?.ai_matching_status as string | null) ?? null;
}

describe('reconcile-indexing-state — cron config guard', () => {
  it('runs as an hourly cron, offset from the storage-cleanup cron', () => {
    expect(reconcileIndexingState.opts.triggers).toEqual([{ cron: '15,45 * * * *' }]);
  });

  it('caps concurrency at 1 so two ticks never overlap', () => {
    expect(reconcileIndexingState.opts.concurrency).toEqual({ limit: 1 });
  });
});

describe('runReconcileIndexingFlow', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marks a drained-but-stuck event ready (missed maybe-mark-event-ready)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'indexing');
    const photo = await createTestPhoto(event.id);
    await setFaceStatus(photo.id, 'indexed'); // terminal → in-flight is 0
    await setThumbStatus(photo.id, 'ready'); // isolate the event sweep from the thumb sweep

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.eventsMarkedReady).toBe(1);
    expect(result.photosRequeued).toBe(0);
    expect(result.thumbnailsRequeued).toBe(0);
    expect(await readAiStatus(event.id)).toBe('ready');
    expect(rec.sent).toHaveLength(0);
  });

  it('re-emits photo.uploaded for wedged in-flight photos and leaves the event indexing', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'indexing');
    const stuck = await createTestPhoto(event.id); // defaults to face_index_status='pending'

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.photosRequeued).toBe(1);
    expect(result.eventsMarkedReady).toBe(0);
    // Still indexing — the re-drive must run before we flip it.
    expect(await readAiStatus(event.id)).toBe('indexing');
    const uploads = rec.sent.filter((e) => e.name === 'photo.uploaded');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].data.photoId).toBe(stuck.id);
  });

  it('leaves failed photos alone (no retry storm) but still drains the event to ready', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'indexing');
    const failed = await createTestPhoto(event.id);
    await setFaceStatus(failed.id, 'failed'); // failed is NOT in-flight

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.photosRequeued).toBe(0);
    expect(result.eventsMarkedReady).toBe(1);
    expect(await readAiStatus(event.id)).toBe('ready');
    expect(rec.sent).toHaveLength(0);
  });

  it('re-emits photo.processed for a terminally-indexed photo whose thumbnail never baked', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'ready'); // event itself is fine; only the thumb is wedged
    const photo = await createTestPhoto(event.id);
    await setFaceStatus(photo.id, 'indexed');
    await setThumbStatus(photo.id, 'pending');

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.thumbnailsRequeued).toBe(1);
    const processed = rec.sent.filter((e) => e.name === 'photo.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0].data.photoId).toBe(photo.id);
    // force:false — a pending thumbnail bakes without it; force is only for
    // re-baking an already-`ready` thumbnail.
    expect((processed[0] as Extract<SentEvent, { name: 'photo.processed' }>).data.force).toBe(
      false,
    );
  });

  it('does NOT touch fresh in-flight work (age guard) — no clobbering live jobs', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'indexing');
    const inFlight = await createTestPhoto(event.id); // pending, just created
    const freshThumb = await createTestPhoto(event.id);
    await setFaceStatus(freshThumb.id, 'indexed');
    await setThumbStatus(freshThumb.id, 'pending');

    const rec = recordingSender();
    // Real now: everything created moments ago is INSIDE the 1h window → fresh.
    const result = await runReconcileIndexingFlow(passthroughStep, Date.now(), rec.send);

    expect(result).toEqual({
      eventsMarkedReady: 0,
      photosRequeued: 0,
      thumbnailsRequeued: 0,
      ownerUploadsRequeued: 0,
    });
    expect(rec.sent).toHaveLength(0);
    expect(await readAiStatus(event.id)).toBe('indexing');
    // Sanity: the rows exist and would have qualified but for the age gate.
    expect(inFlight.id).toBeTruthy();
  });

  // ── T-183: owner uploads stranded in upload_status='pending' ──────────
  it('re-emits photo.uploaded for an owner upload stuck pending in an idle event (T-183)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'idle'); // never entered indexing — the reported gap
    const stuck = await createTestPhoto(event.id); // owner-owned, guest_name/uploaded_by null
    await setUploadStatus(stuck.id, 'pending');

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.ownerUploadsRequeued).toBe(1);
    // Not the stuck-indexing branch (event is idle, not indexing).
    expect(result.photosRequeued).toBe(0);
    expect(result.eventsMarkedReady).toBe(0);
    const uploads = rec.sent.filter((e) => e.name === 'photo.uploaded');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].data.photoId).toBe(stuck.id);
    // Re-drive, not blind-promote: the worker (not the cron) flips the status,
    // preserving the byte-validation gate. The row is still pending post-flow.
    expect(await readUploadStatus(stuck.id)).toBe('pending');
  });

  it('does NOT re-drive a contributor pending upload — only owner uploads (T-183 scoping)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const contributor = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'idle');
    // Contributor upload: user_id != owner, uploaded_by set → legitimately
    // pending for the moderation queue; the cron must leave it alone.
    await createContributorPhoto(event.id, contributor.id);

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.ownerUploadsRequeued).toBe(0);
    expect(rec.sent).toHaveLength(0);
  });

  it('does NOT re-drive a fresh owner pending upload (age guard) — T-183', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'idle');
    const fresh = await createTestPhoto(event.id);
    await setUploadStatus(fresh.id, 'pending');

    const rec = recordingSender();
    // Real now: the row was created moments ago → inside the 1h window.
    const result = await runReconcileIndexingFlow(passthroughStep, Date.now(), rec.send);

    expect(result.ownerUploadsRequeued).toBe(0);
    expect(rec.sent).toHaveLength(0);
  });

  // ── T-231: an exhausted owner upload must not be re-driven forever ────
  it('does NOT re-drive an owner upload whose indexing already failed (T-231 retry storm)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'idle');
    const exhausted = await createTestPhoto(event.id);
    // The shape a run that died before `promote-upload-status` leaves behind:
    // upload_status never settled, face_index_status marked failed by onFailure.
    // Before T-231 branch (d) matched on `pending` alone and re-emitted this
    // photo on every tick — every 30 minutes, forever, with no way to succeed.
    await setUploadStatus(exhausted.id, 'pending');
    await setFaceStatus(exhausted.id, 'failed');

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.ownerUploadsRequeued).toBe(0);
    expect(rec.sent.filter((e) => e.name === 'photo.uploaded')).toHaveLength(0);
  });

  it('still re-drives an owner upload whose indexing has NOT failed (T-231 scoping)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'idle');
    const stuck = await createTestPhoto(event.id);
    await setUploadStatus(stuck.id, 'pending');
    await setFaceStatus(stuck.id, 'not_applicable'); // AI off: settled, but not failed

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    expect(result.ownerUploadsRequeued).toBe(1);
  });

  it('lets the stuck-indexing branch own owner uploads in an indexing event — no double re-emit (T-183)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await setAiStatus(event.id, 'indexing');
    const stuck = await createTestPhoto(event.id); // face_index_status defaults to 'pending'
    await setUploadStatus(stuck.id, 'pending');

    const rec = recordingSender();
    const result = await runReconcileIndexingFlow(passthroughStep, FUTURE_NOW, rec.send);

    // Branch (a) re-drives it; branch (d) excludes indexing events → no dup.
    expect(result.photosRequeued).toBe(1);
    expect(result.ownerUploadsRequeued).toBe(0);
    const uploads = rec.sent.filter((e) => e.name === 'photo.uploaded');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].data.photoId).toBe(stuck.id);
  });
});
