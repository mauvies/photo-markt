/**
 * T-088: pins a deliberate design decision — the thumbnail worker
 * (`generate-photo-thumbnails.ts`) only busts the event-DETAIL cache tag,
 * never the listing tags. Thumbnail readiness doesn't change the
 * approved-photo count; that promotion (and its listing-tag bust) already
 * happened upstream in `index-photo-faces`, so busting listing tags again
 * here would just thrash the public caches for no visibility change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import sharp from 'sharp';
import { runGeneratePhotoThumbnailsFlow } from '@/lib/inngest/functions/generate-photo-thumbnails';
import type { PhotoUploadStep } from '@/lib/inngest/functions/index-photo-faces';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const passthroughStep: PhotoUploadStep = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

async function uploadJpeg(path: string): Promise<number> {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 180, g: 120, b: 80 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  const sb = createServiceClient();
  const { error } = await sb.storage
    .from('photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`uploadJpeg: ${error.message}`);
  return bytes.byteLength;
}

async function insertPhoto(args: {
  userId: string;
  eventId: string;
  originalUrl: string;
  sizeBytes: number;
}): Promise<{ id: string }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      original_url: args.originalUrl,
      size_bytes: args.sizeBytes,
      upload_status: 'approved',
      thumbnail_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPhoto: ${error?.message ?? 'no data'}`);
  return data as { id: string };
}

describe('runGeneratePhotoThumbnailsFlow — cache tag revalidation (T-088)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
    vi.mocked(revalidateTag).mockClear();
  });

  it('only busts the event-detail tag, never the listing tags', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);

    const storagePath = `${owner.id}/${event.id}/thumb-source.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: owner.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
    });

    await runGeneratePhotoThumbnailsFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
    );

    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toContain(`event-${event.id}`);
    expect(tags).not.toContain('events-public');
    expect(tags).not.toContain('top-events');
    expect(tags).not.toContain(`photographer-events-${owner.id}`);
    expect(tags).not.toContain(`dashboard-photographer-${owner.id}`);
  });
});
