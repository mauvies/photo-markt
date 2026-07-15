/**
 * Integration tests for `getPhotoPreviewUrls` (`src/database/queries/photos.ts`).
 *
 * T-131/T-133: the shared cart preview resolver. When a photo's thumbnail
 * hasn't baked yet, the pre-bake fallback must never serve a direct signed URL
 * of the raw original for anything payment-gated ("full resolution only after
 * purchase"): watermarked events (T-131) AND sellable no-watermark events
 * (T-133) both go through the fail-closed /api/watermark/ route, which picks
 * the treatment server-side. Only an event positively known to be free AND
 * un-watermarked keeps the direct signed original (nothing to protect). A
 * `ready` thumbnail always wins via /api/thumb/.
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

  it('serves the fail-closed watermark route (not the raw original) for a SELLABLE no-watermark event with a pending thumbnail (T-133)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    // Sellable but the photographer disabled the visible mark: the full-res
    // original is still payment-gated (steady state serves the downscaled
    // medium thumb), so the pre-bake fallback must not expose it either.
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    await createServiceClient()
      .from('events')
      .update({ watermark_enabled: false })
      .eq('id', event.id);

    const result = await getPhotoPreviewUrls(createServiceClient(), [photo.id], BASE_URL);

    // The regression: before T-133 this resolved to a direct signed URL of the
    // full-resolution original — anyone could save the sellable photo without
    // paying, just because the event had no visible watermark.
    expect(result[photo.id]).toBe(`${BASE_URL}/api/watermark/${originalUrl}`);
    expect(result[photo.id]).not.toContain('/storage/v1/object/sign/');
  });

  it('serves a direct signed original for a genuinely FREE no-watermark event with a pending thumbnail', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    // No price and no watermark: a "purchase" would grant nothing beyond what
    // the photographer already gives away — nothing to protect (decided in
    // T-133). Both null and 0 prices count as free.
    const nullPriceEvent = await createTestEvent(photographer.id, { price_per_photo: null });
    const zeroPriceEvent = await createTestEvent(photographer.id, { price_per_photo: 0 });
    const photos = [];
    for (const event of [nullPriceEvent, zeroPriceEvent]) {
      const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
      await uploadStubBytes(originalUrl);
      photos.push(
        await createTestPhoto(event.id, { user_id: photographer.id, original_url: originalUrl }),
      );
      await createServiceClient()
        .from('events')
        .update({ watermark_enabled: false })
        .eq('id', event.id);
    }

    const result = await getPhotoPreviewUrls(
      createServiceClient(),
      photos.map((p) => p.id),
      BASE_URL,
    );

    for (const photo of photos) {
      expect(result[photo.id]).toContain('/storage/v1/object/sign/');
      expect(result[photo.id]).not.toContain('/api/watermark/');
    }
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
