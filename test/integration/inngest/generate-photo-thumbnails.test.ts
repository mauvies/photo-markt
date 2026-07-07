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
import { checkerboardJpeg, regionStdev } from '../../helpers/image';
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

/** Upload a high-frequency checkerboard so a face blur is measurable as a big
 *  drop in local stdev (a flat fill wouldn't change under blur). */
async function uploadCheckerboard(path: string, width = 800, height = 600): Promise<number> {
  const bytes = await checkerboardJpeg(width, height);
  const sb = createServiceClient();
  const { error } = await sb.storage
    .from('photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`uploadCheckerboard: ${error.message}`);
  return bytes.byteLength;
}

/** Insert a persisted face box (what index-photo-faces writes) for a photo. */
async function insertFace(photoId: string, box: Record<string, number>): Promise<void> {
  const sb = createServiceClient();
  const { error } = await sb.from('photo_faces').insert({
    photo_id: photoId,
    aws_face_id: `face-${photoId}`,
    aws_collection_id: 'test-collection',
    confidence: 99,
    bounding_box: box,
  });
  if (error) throw new Error(`insertFace: ${error.message}`);
}

async function downloadThumb(storagePath: string, size: 'small' | 'medium'): Promise<Buffer> {
  const sb = createServiceClient();
  const { data } = await sb.storage.from('photos').download(thumbStoragePath(storagePath, size));
  if (!data) throw new Error(`thumb ${size} not found`);
  return Buffer.from(await data.arrayBuffer());
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

  // T-068: chained after indexing, the paid-event thumbnail bakes with the
  // persisted face boxes → every indexed face is blurred in the stored thumb.
  it('blurs indexed faces in the paid-event thumbnail (tile-only when none)', async () => {
    const sb = createServiceClient();
    const user = await createTestUser(ROLES.PHOTOGRAPHER, { email: 'thumb-blur@test.com' });
    const event = await createTestEvent(user.id);
    await sb.from('events').update({ watermark_enabled: true }).eq('id', event.id);

    // Photo WITH an indexed face box centered on the image.
    const facePath = `${user.id}/${event.id}/photo-with-face.jpg`;
    const faceSize = await uploadCheckerboard(facePath);
    const facePhoto = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: facePath,
      sizeBytes: faceSize,
      uploadStatus: 'approved',
    });
    await insertFace(facePhoto.id, { Left: 0.35, Top: 0.35, Width: 0.3, Height: 0.3 });

    // Control photo on the same event, NO face rows → tile-only, no blur.
    const plainPath = `${user.id}/${event.id}/photo-no-face.jpg`;
    const plainSize = await uploadCheckerboard(plainPath);
    const plainPhoto = await insertPhoto({
      userId: user.id,
      eventId: event.id,
      originalUrl: plainPath,
      sizeBytes: plainSize,
      uploadStatus: 'approved',
    });

    await runGeneratePhotoThumbnailsFlow(
      { photoId: facePhoto.id, eventId: event.id, storagePath: facePath },
      passthroughStep,
    );
    await runGeneratePhotoThumbnailsFlow(
      { photoId: plainPhoto.id, eventId: event.id, storagePath: plainPath },
      passthroughStep,
    );

    const faceThumb = await downloadThumb(facePath, 'medium');
    const plainThumb = await downloadThumb(plainPath, 'medium');
    const meta = await sharp(faceThumb).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    // Sample the center of the (0.35–0.65) face box, inset to stay inside it.
    const core = {
      left: Math.round(w * 0.42),
      top: Math.round(h * 0.42),
      width: Math.round(w * 0.16),
      height: Math.round(h * 0.16),
    };

    const blurred = await regionStdev(faceThumb, core);
    const detailed = await regionStdev(plainThumb, core);
    expect(blurred).toBeLessThan(detailed * 0.6);
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
