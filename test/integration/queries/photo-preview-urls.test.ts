/**
 * Integration tests for `getPhotoPreviewUrls` (`src/database/queries/photos.ts`).
 *
 * T-131: the shared cart preview resolver. When a photo's thumbnail hasn't
 * baked yet, the pre-bake fallback must honor the event's watermark policy —
 * watermarked (payment-gated) events go through the fail-closed /api/watermark/
 * route, NEVER a direct signed URL of the raw original ("full resolution only
 * after purchase"). Free / no-watermark events keep the direct signed original
 * (nothing to protect). A `ready` thumbnail always wins via /api/thumb/.
 *
 * This is the single point both cart surfaces (guest + authenticated) share,
 * so the invariant is asserted once here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getPhotoPreviewUrls } from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

const BASE_URL = 'https://test.local';

/** Upload a stub byte at `path` so `createSignedUrl` has a real object to sign. */
async function uploadStubBytes(path: string) {
  await ensurePhotosBucket();
  const sb = createServiceClient();
  await sb.storage
    .from('photos')
    .upload(path, new Uint8Array([0xff]), { contentType: 'image/jpeg', upsert: true });
}

describe('getPhotoPreviewUrls', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty map for an empty input', async () => {
    const result = await getPhotoPreviewUrls(createServiceClient(), [], BASE_URL);
    expect(result).toEqual({});
  });

  it('serves the fail-closed watermark route (not the raw original) for a watermarked event with a pending thumbnail', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    // Events are watermark_enabled by default (DB default true).
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });

    const result = await getPhotoPreviewUrls(createServiceClient(), [photo.id], BASE_URL);

    // The regression: before T-131 this resolved to a direct signed URL of the
    // un-watermarked original — anyone could open it from devtools and save the
    // full-res photo without paying.
    expect(result[photo.id]).toBe(`${BASE_URL}/api/watermark/${originalUrl}`);
    expect(result[photo.id]).not.toContain('/storage/v1/object/sign/');
  });

  it('serves a direct signed original for a free (no-watermark) event with a pending thumbnail', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    // Free event: nothing to protect, keep the current direct-sign behavior.
    await createServiceClient()
      .from('events')
      .update({ watermark_enabled: false })
      .eq('id', event.id);

    const result = await getPhotoPreviewUrls(createServiceClient(), [photo.id], BASE_URL);

    expect(result[photo.id]).toContain('/storage/v1/object/sign/');
    expect(result[photo.id]).not.toContain('/api/watermark/');
  });

  it('serves the baked immutable thumbnail when ready, regardless of watermark policy', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    await createServiceClient()
      .from('photos')
      .update({ thumbnail_status: 'ready', thumb_version: 4 })
      .eq('id', photo.id);

    const result = await getPhotoPreviewUrls(createServiceClient(), [photo.id], BASE_URL);

    expect(result[photo.id]).toContain('/api/thumb/');
    expect(result[photo.id]).toContain('?v=4');
    expect(result[photo.id]).not.toContain('/api/watermark/');
    expect(result[photo.id]).not.toContain('/storage/v1/object/sign/');
  });

  it('fails closed to null (never the raw original) when baseUrl is missing for a watermarked event', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });

    // A blank baseUrl can't build a watermark URL — createPhotoUrls fails closed
    // to null rather than leaking the original. Never a signed original.
    const result = await getPhotoPreviewUrls(createServiceClient(), [photo.id], '');

    expect(result[photo.id]).toBeNull();
  });
});
