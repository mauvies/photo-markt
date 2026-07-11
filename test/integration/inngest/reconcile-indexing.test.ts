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
    });
    expect(rec.sent).toHaveLength(0);
    expect(await readAiStatus(event.id)).toBe('indexing');
    // Sanity: the rows exist and would have qualified but for the age gate.
    expect(inFlight.id).toBeTruthy();
  });
});
