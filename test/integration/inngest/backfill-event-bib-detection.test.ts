/**
 * T-089: characterization + concurrency-config guard for the
 * `event.bib-detection-enabled` backfill worker.
 *
 * The flow body `runBackfillEventBibDetectionFlow` is invoked directly with a
 * pass-through step and a spy fan-out sender. The backfill itself makes no AWS
 * call (DetectText happens later in the per-photo worker), so nothing is
 * mocked; every DB side effect hits the local Supabase stack.
 *
 * Characterization (green before & after T-089): lists photos still needing
 * detection, resets them to `pending`, and fans out one `photo.bib-detect`
 * per listed photo. T-089 adds the per-event `concurrency: limit 1` cap,
 * guarded separately below.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  bulkSetPhotoBibDetectionStatus,
  updateEventBibDetectionState,
} from '@/database/queries/bib-numbers';
import { BACKFILL_DEBOUNCE_PERIOD } from '@/lib/inngest/functions/backfill-config';
import {
  backfillEventBibDetection,
  type PhotoBibDetectFanoutSender,
  runBackfillEventBibDetectionFlow,
} from '@/lib/inngest/functions/backfill-event-bib-detection';
import type { InngestStepRunner } from '@/lib/inngest/step';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const passthroughStep: InngestStepRunner = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

function recordingSender(): {
  send: PhotoBibDetectFanoutSender;
  batches: Array<Array<{ name: 'photo.bib-detect'; data: { photoId: string } }>>;
} {
  const batches: Array<Array<{ name: 'photo.bib-detect'; data: { photoId: string } }>> = [];
  return {
    batches,
    send: async (events) => {
      batches.push(events as never);
      return undefined;
    },
  };
}

async function readBibStatus(photoId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('bib_detection_status')
    .eq('id', photoId)
    .single();
  return (data?.bib_detection_status as string | null) ?? null;
}

async function readEventBibStatus(eventId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('events')
    .select('bib_detection_status')
    .eq('id', eventId)
    .single();
  return (data?.bib_detection_status as string | null) ?? null;
}

describe('backfill-event-bib-detection — de-dupe config (T-089)', () => {
  it('debounces rapid duplicate triggers per event (collapses double-clicks)', () => {
    expect(backfillEventBibDetection.opts.debounce).toEqual({
      key: 'event.data.eventId',
      period: BACKFILL_DEBOUNCE_PERIOD,
    });
  });

  it('serializes any overlapping runs per event with a concurrency limit of 1', () => {
    expect(backfillEventBibDetection.opts.concurrency).toEqual([
      { limit: 1, key: 'event.data.eventId' },
    ]);
  });
});

describe('runBackfillEventBibDetectionFlow — characterization', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('lists undetected photos, resets them to pending, and fans out one photo.bib-detect each', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventBibDetectionState(createServiceClient(), event.id, { enabled: true });

    // Two photos never run (bib_detection_status NULL) + one already detected.
    const undetectedA = await createTestPhoto(event.id);
    const undetectedB = await createTestPhoto(event.id);
    const alreadyDetected = await createTestPhoto(event.id);
    await bulkSetPhotoBibDetectionStatus(createServiceClient(), [alreadyDetected.id], 'detected');

    const rec = recordingSender();
    const result = await runBackfillEventBibDetectionFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ processed: 2 });

    expect(rec.batches).toHaveLength(1);
    const fannedOutIds = rec.batches[0].map((e) => e.data.photoId).sort();
    expect(fannedOutIds).toEqual([undetectedA.id, undetectedB.id].sort());
    expect(rec.batches[0].every((e) => e.name === 'photo.bib-detect')).toBe(true);

    // Reset to pending; the already-detected photo is untouched.
    expect(await readBibStatus(undetectedA.id)).toBe('pending');
    expect(await readBibStatus(alreadyDetected.id)).toBe('detected');

    // The event flipped to 'detecting' (photos remain to process).
    expect(await readEventBibStatus(event.id)).toBe('detecting');
  });

  it('skips an event that is not eligible (bib detection disabled)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await createTestPhoto(event.id);

    const rec = recordingSender();
    const result = await runBackfillEventBibDetectionFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ skipped: true, reason: 'event-not-eligible' });
    expect(rec.batches).toHaveLength(0);
  });

  it('marks the event ready and fans out nothing when every photo is already detected', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventBibDetectionState(createServiceClient(), event.id, { enabled: true });
    const detected = await createTestPhoto(event.id);
    await bulkSetPhotoBibDetectionStatus(createServiceClient(), [detected.id], 'detected');

    const rec = recordingSender();
    const result = await runBackfillEventBibDetectionFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ processed: 0 });
    expect(rec.batches).toHaveLength(0);
    expect(await readEventBibStatus(event.id)).toBe('ready');
  });
});
