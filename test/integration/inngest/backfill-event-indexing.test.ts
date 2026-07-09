/**
 * T-089: characterization + concurrency-config guard for the
 * `event.ai-matching-enabled` backfill worker.
 *
 * The flow body `runBackfillEventIndexingFlow` is invoked directly with a
 * pass-through step and a spy fan-out sender (no Inngest runtime). The only
 * AWS call (`createCollection`) is mocked; every DB side effect hits the
 * local Supabase stack.
 *
 * Characterization (green before & after the T-089 change — the flow body is
 * unchanged): lists the non-terminal photos, resets them to `pending`, and
 * fans out one `photo.uploaded` per listed photo. The T-089 change adds a
 * per-event `concurrency: limit 1` cap, guarded separately below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCollectionMock } = vi.hoisted(() => ({ createCollectionMock: vi.fn() }));
vi.mock('@/lib/aws/face-indexing', () => ({ createCollection: createCollectionMock }));

import { updateEventRekognitionState } from '@/database/queries/rekognition';
import { BACKFILL_DEBOUNCE_PERIOD } from '@/lib/inngest/functions/backfill-config';
import {
  backfillEventIndexing,
  type PhotoUploadedFanoutSender,
  runBackfillEventIndexingFlow,
} from '@/lib/inngest/functions/backfill-event-indexing';
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

/** Records every fan-out batch the flow sends. */
function recordingSender(): {
  send: PhotoUploadedFanoutSender;
  batches: Array<Array<{ name: 'photo.uploaded'; data: { photoId: string } }>>;
} {
  const batches: Array<Array<{ name: 'photo.uploaded'; data: { photoId: string } }>> = [];
  return {
    batches,
    send: async (events) => {
      batches.push(events as never);
      return undefined;
    },
  };
}

async function setStatus(photoId: string, status: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('photos')
    .update({ face_index_status: status })
    .eq('id', photoId);
  if (error) throw new Error(`setStatus: ${error.message}`);
}

async function readStatus(photoId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('face_index_status')
    .eq('id', photoId)
    .single();
  return (data?.face_index_status as string | null) ?? null;
}

async function readAiStatus(eventId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('events')
    .select('ai_matching_status')
    .eq('id', eventId)
    .single();
  return (data?.ai_matching_status as string | null) ?? null;
}

describe('backfill-event-indexing — de-dupe config (T-089)', () => {
  it('debounces rapid duplicate triggers per event (collapses double-clicks)', () => {
    expect(backfillEventIndexing.opts.debounce).toEqual({
      key: 'event.data.eventId',
      period: BACKFILL_DEBOUNCE_PERIOD,
    });
  });

  it('serializes any overlapping runs per event with a concurrency limit of 1', () => {
    expect(backfillEventIndexing.opts.concurrency).toEqual([
      { limit: 1, key: 'event.data.eventId' },
    ]);
  });
});

describe('runBackfillEventIndexingFlow — characterization', () => {
  beforeEach(async () => {
    await resetDatabase();
    createCollectionMock.mockReset();
  });

  it('lists non-terminal photos, resets them to pending, and fans out one photo.uploaded each', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventRekognitionState(createServiceClient(), event.id, { enabled: true });

    const pending = await createTestPhoto(event.id);
    const failed = await createTestPhoto(event.id);
    const alreadyIndexed = await createTestPhoto(event.id);
    await setStatus(pending.id, 'pending');
    await setStatus(failed.id, 'failed');
    await setStatus(alreadyIndexed.id, 'indexed'); // terminal → excluded

    const rec = recordingSender();
    const result = await runBackfillEventIndexingFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ processed: 2 });

    // Exactly one fan-out batch, containing the two non-terminal photos only.
    expect(rec.batches).toHaveLength(1);
    const fannedOutIds = rec.batches[0].map((e) => e.data.photoId).sort();
    expect(fannedOutIds).toEqual([pending.id, failed.id].sort());
    expect(rec.batches[0].every((e) => e.name === 'photo.uploaded')).toBe(true);

    // The failed photo was reset to pending; the indexed one is untouched.
    expect(await readStatus(failed.id)).toBe('pending');
    expect(await readStatus(alreadyIndexed.id)).toBe('indexed');

    // Collection materialized and the event flipped to 'indexing'.
    expect(createCollectionMock).toHaveBeenCalledTimes(1);
    expect(await readAiStatus(event.id)).toBe('indexing');
  });

  it('skips an event that is not eligible (AI disabled)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id); // ai_matching_enabled defaults false
    await createTestPhoto(event.id);

    const rec = recordingSender();
    const result = await runBackfillEventIndexingFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ skipped: true, reason: 'event-not-eligible' });
    expect(rec.batches).toHaveLength(0);
    expect(createCollectionMock).not.toHaveBeenCalled();
  });

  it('marks the event ready and fans out nothing when no photos need indexing', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await updateEventRekognitionState(createServiceClient(), event.id, { enabled: true });
    const indexed = await createTestPhoto(event.id);
    await setStatus(indexed.id, 'indexed');

    const rec = recordingSender();
    const result = await runBackfillEventIndexingFlow(
      { eventId: event.id, userId: owner.id },
      passthroughStep,
      rec.send,
    );

    expect(result).toEqual({ processed: 0 });
    expect(rec.batches).toHaveLength(0);
    expect(await readAiStatus(event.id)).toBe('ready');
  });
});
