/**
 * Integration tests for the `generate-photo-thumbnails` Inngest worker.
 *
 * The worker is invoked directly via `runGeneratePhotoThumbnailsFlow` with
 * a pass-through step substitute — no Inngest runtime required.
 *
 * What's tested:
 *   - Free event: originals resized directly → small + medium WebP; status → ready
 *   - Paid event (watermark_enabled=true): watermarked source → thumbnails
 *   - Rejected photo: worker skips without writing thumbs
 *   - Missing photo row: worker skips without error
 *   - Idempotency: running twice (upsert) does not fail
 */

import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { runGeneratePhotoThumbnailsFlow } from '@/lib/inngest/functions/generate-photo-thumbnails';
import type { PhotoUploadStep } from '@/lib/inngest/functions/index-photo-faces';
import { ROLES } from '@/lib/roles';
import { thumbStoragePath } from '@/lib/thumbnails';
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
  uploadStatus?: string;
}): Promise<{ id: string }> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      original_url: args.originalUrl,
      size_bytes: args.sizeBytes,
      upload_status: args.uploadStatus ?? 'pending',
      thumbnail_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPhoto: ${error?.message ?? 'no data'}`);
  return data as { id: string };
}

async function readThumbnailStatus(photoId: string): Promise<string | null> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('photos')
    .select('thumbnail_status')
    .eq('id', photoId)
    .single();
  if (error || !data) throw new Error(`readThumbnailStatus: ${error?.message ?? 'not found'}`);
  return (data as { thumbnail_status: string | null }).thumbnail_status;
}

async function storageObjectExists(path: string): Promise<boolean> {
  const sb = createServiceClient();
  const { data } = await sb.storage.from('photos').download(path);
  return data !== null;
}

describe('runGeneratePhotoThumbnailsFlow', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
  });

  it('generates small and medium WebP thumbnails for a free event', async () => {
    const user = await createTestUser(ROLES.PHOTOGRAPHER, { email: 'thumb-free@test.com' });
    const event = await createTestEvent(user.id);
    const storagePath = `${user.id}/${event.id}/photo-free.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'approved',
    });

    await runGeneratePhotoThumbnailsFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
    );

    expect(await readThumbnailStatus(photo.id)).toBe('ready');

    expect(await storageObjectExists(thumbStoragePath(storagePath, 'small'))).toBe(true);
    expect(await storageObjectExists(thumbStoragePath(storagePath, 'medium'))).toBe(true);

    // Verify the small thumbnail is valid WebP at ≤ 400px longest side
    const sb = createServiceClient();
    const { data: smallBlob } = await sb.storage
      .from('photos')
      .download(thumbStoragePath(storagePath, 'small'));
    expect(smallBlob).not.toBeNull();
    const smallBuf = Buffer.from(await smallBlob!.arrayBuffer());
    const smallMeta = await sharp(smallBuf).metadata();
    expect(smallMeta.format).toBe('webp');
    expect(Math.max(smallMeta.width ?? 0, smallMeta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it('generates thumbnails for a paid event (watermark_enabled=true)', async () => {
    const sb = createServiceClient();
    const user = await createTestUser(ROLES.PHOTOGRAPHER, { email: 'thumb-paid@test.com' });
    const event = await createTestEvent(user.id);
    // Set watermark_enabled=true so the worker applies the watermark pipeline
    await sb.from('events').update({ watermark_enabled: true }).eq('id', event.id);

    const storagePath = `${user.id}/${event.id}/photo-paid.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'approved',
    });

    await runGeneratePhotoThumbnailsFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
    );

    expect(await readThumbnailStatus(photo.id)).toBe('ready');
    expect(await storageObjectExists(thumbStoragePath(storagePath, 'small'))).toBe(true);
    expect(await storageObjectExists(thumbStoragePath(storagePath, 'medium'))).toBe(true);
  });

  it('skips a rejected photo without writing thumbs', async () => {
    const user = await createTestUser(ROLES.PHOTOGRAPHER, { email: 'thumb-rejected@test.com' });
    const event = await createTestEvent(user.id);
    const storagePath = `${user.id}/${event.id}/photo-rejected.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'rejected',
    });

    const result = await runGeneratePhotoThumbnailsFlow(
      { photoId: photo.id, eventId: event.id, storagePath },
      passthroughStep,
    );

    expect((result as { outcome: string }).outcome).toBe('skipped');
    expect(await readThumbnailStatus(photo.id)).toBe('pending');
    expect(await storageObjectExists(thumbStoragePath(storagePath, 'small'))).toBe(false);
  });

  it('skips a missing photo row without error', async () => {
    const user = await createTestUser(ROLES.PHOTOGRAPHER, { email: 'thumb-missing@test.com' });
    const event = await createTestEvent(user.id);

    const result = await runGeneratePhotoThumbnailsFlow(
      {
        photoId: '00000000-0000-0000-0000-000000000000',
        eventId: event.id,
        storagePath: `${user.id}/${event.id}/gone.jpg`,
      },
      passthroughStep,
    );

    expect((result as { outcome: string }).outcome).toBe('skipped');
  });

  it('is idempotent — running twice does not fail', async () => {
    const user = await createTestUser(ROLES.PHOTOGRAPHER, {
      email: 'thumb-idempotent@test.com',
    });
    const event = await createTestEvent(user.id);
    const storagePath = `${user.id}/${event.id}/photo-idem.jpg`;
    const sizeBytes = await uploadJpeg(storagePath);
    const photo = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: storagePath,
      sizeBytes,
      uploadStatus: 'approved',
    });

    const payload = { photoId: photo.id, eventId: event.id, storagePath };
    await runGeneratePhotoThumbnailsFlow(payload, passthroughStep);
    await expect(runGeneratePhotoThumbnailsFlow(payload, passthroughStep)).resolves.not.toThrow();
    expect(await readThumbnailStatus(photo.id)).toBe('ready');
  });
});
