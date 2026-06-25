/**
 * Integration tests for the `detect-photo-bibs` Inngest worker (T-032).
 *
 * The flow body `runDetectPhotoBibsFlow` is invoked directly with a
 * pass-through step (no Inngest runtime). Only the AWS DetectText call is
 * mocked; image prep (Sharp) runs for real on a tiny uploaded jpeg, and all
 * DB side effects hit the local Supabase stack.
 */

import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detectTextMock } = vi.hoisted(() => ({ detectTextMock: vi.fn() }));
vi.mock('@/lib/aws/bib-detection', () => ({ detectTextForPhoto: detectTextMock }));

import { updateEventBibDetectionState } from '@/database/queries/bib-numbers';
import {
  type BibDetectStep,
  runDetectPhotoBibsFlow,
} from '@/lib/inngest/functions/detect-photo-bibs';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const passthroughStep: BibDetectStep = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

async function uploadJpeg(path: string, sb = createServiceClient()): Promise<void> {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#334455' },
  })
    .jpeg()
    .toBuffer();
  const { error } = await sb.storage
    .from('photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`uploadJpeg: ${error.message}`);
}

async function setup(opts: { enabled: boolean }) {
  const owner = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(owner.id);
  const sb = createServiceClient();
  if (opts.enabled) {
    await updateEventBibDetectionState(sb, event.id, { enabled: true });
  }
  const path = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
  await uploadJpeg(path, sb);
  const photo = await createTestPhoto(event.id, { original_url: path });
  return { event, photo, path, sb };
}

async function readBibStatus(photoId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('photos')
    .select('bib_detection_status')
    .eq('id', photoId)
    .single();
  return (data?.bib_detection_status as string | null) ?? null;
}

async function readBibRows(photoId: string): Promise<string[]> {
  const { data } = await createServiceClient()
    .from('photo_bib_numbers')
    .select('bib_text')
    .eq('photo_id', photoId);
  return (data ?? []).map((r) => r.bib_text as string).sort();
}

describe('detect-photo-bibs worker (T-032)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    detectTextMock.mockReset();
  });

  it('persists filtered bibs and marks the photo detected on an opted-in event', async () => {
    detectTextMock.mockResolvedValue([
      { text: '1432', confidence: 99, boundingBox: null },
      { text: 'ACME', confidence: 99, boundingBox: null }, // sponsor text, filtered out
    ]);
    const { event, photo, path } = await setup({ enabled: true });

    await runDetectPhotoBibsFlow(
      { photoId: photo.id, eventId: event.id, storagePath: path },
      passthroughStep,
    );

    expect(detectTextMock).toHaveBeenCalledTimes(1);
    expect(await readBibRows(photo.id)).toEqual(['1432']);
    expect(await readBibStatus(photo.id)).toBe('detected');
  });

  it('marks no_bibs and persists nothing when nothing passes the filter', async () => {
    detectTextMock.mockResolvedValue([{ text: 'FINISH', confidence: 99, boundingBox: null }]);
    const { event, photo, path } = await setup({ enabled: true });

    await runDetectPhotoBibsFlow(
      { photoId: photo.id, eventId: event.id, storagePath: path },
      passthroughStep,
    );

    expect(await readBibRows(photo.id)).toEqual([]);
    expect(await readBibStatus(photo.id)).toBe('no_bibs');
  });

  it('skips entirely (no AWS call, status stays null) when the event has not opted in', async () => {
    const { event, photo, path } = await setup({ enabled: false });

    const result = await runDetectPhotoBibsFlow(
      { photoId: photo.id, eventId: event.id, storagePath: path },
      passthroughStep,
    );

    expect(result).toMatchObject({ skipped: true });
    expect(detectTextMock).not.toHaveBeenCalled();
    expect(await readBibRows(photo.id)).toEqual([]);
    expect(await readBibStatus(photo.id)).toBeNull();
  });
});
