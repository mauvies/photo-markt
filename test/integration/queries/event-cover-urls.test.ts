/**
 * Integration tests for the event cover / OG image URL chokepoints
 * (`src/database/queries/event-covers.ts`, T-140).
 *
 * Event cards (talent explore, saved events, photographer profile) and the
 * public event page's `og:image` fall back to the FIRST photo's original when
 * an event has no dedicated cover. That fallback used to be direct-signed —
 * shipping a `/storage/v1/object/sign/` URL to the full-resolution,
 * payment-gated original in the card payload / `<meta og:image>`, downloadable
 * from devtools or an OG scraper without paying. The same pre-bake leak
 * T-131/T-133/T-136 closed on the cart + gallery surfaces.
 *
 * `signEventCoverUrls` (cards) and `resolveEventOgImageUrl` (OG) both route a
 * protected first-photo cover through the fail-closed `/api/watermark/` route;
 * only a genuinely free AND un-watermarked event keeps the direct signed
 * original. A dedicated cover (T-055) is always direct-signed (promotional
 * image, not a for-sale photo).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveEventOgImageUrl, signEventCoverUrls } from '@/database/queries/event-covers';
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

describe('signEventCoverUrls (event-card cover fallback, T-140)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty map for an empty input', async () => {
    const result = await signEventCoverUrls(createServiceClient(), []);
    expect(result.size).toBe(0);
  });

  it('routes a SELLABLE no-watermark first-photo cover through /api/watermark/ — never a direct signed original', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 10 });
    const coverPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    // Real object so a direct sign WOULD succeed — before T-140 the card signed
    // exactly this original and anyone could save it from devtools without paying.
    await uploadStubBytes(coverPath);

    const result = await signEventCoverUrls(createServiceClient(), [
      {
        eventId: event.id,
        coverPath,
        isDedicatedCover: false,
        watermarkEnabled: false,
        pricePerPhoto: 10,
      },
    ]);

    expect(result.get(event.id)).toBe(`/api/watermark/${coverPath}`);
    expect(result.get(event.id)).not.toContain('/storage/v1/object/sign/');
  });

  it('routes a watermarked first-photo cover through /api/watermark/', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const coverPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(coverPath);

    const result = await signEventCoverUrls(createServiceClient(), [
      {
        eventId: event.id,
        coverPath,
        isDedicatedCover: false,
        watermarkEnabled: true,
        pricePerPhoto: null,
      },
    ]);

    expect(result.get(event.id)).toBe(`/api/watermark/${coverPath}`);
  });

  it('protects a ZERO-priced no-watermark first-photo cover (0 counts as for-sale)', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 0 });
    const coverPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(coverPath);

    const result = await signEventCoverUrls(createServiceClient(), [
      {
        eventId: event.id,
        coverPath,
        isDedicatedCover: false,
        watermarkEnabled: false,
        pricePerPhoto: 0,
      },
    ]);

    expect(result.get(event.id)).toBe(`/api/watermark/${coverPath}`);
    expect(result.get(event.id)).not.toContain('/storage/v1/object/sign/');
  });

  it('keeps the direct signed original for a genuinely FREE no-watermark first-photo cover', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: null });
    const coverPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(coverPath);

    const result = await signEventCoverUrls(createServiceClient(), [
      {
        eventId: event.id,
        coverPath,
        isDedicatedCover: false,
        watermarkEnabled: false,
        pricePerPhoto: null,
      },
    ]);

    expect(result.get(event.id)).toContain('/storage/v1/object/sign/');
    expect(result.get(event.id)).not.toContain('/api/watermark/');
  });

  it('always direct-signs a DEDICATED cover, even for a for-sale watermarked event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 10 });
    const coverPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(coverPath);

    const result = await signEventCoverUrls(createServiceClient(), [
      {
        eventId: event.id,
        coverPath,
        // A dedicated cover is a chosen promotional image — not a for-sale
        // photo — so protection does NOT apply even though the event sells.
        isDedicatedCover: true,
        watermarkEnabled: true,
        pricePerPhoto: 10,
      },
    ]);

    expect(result.get(event.id)).toContain('/storage/v1/object/sign/');
    expect(result.get(event.id)).not.toContain('/api/watermark/');
  });
});

describe('resolveEventOgImageUrl (public event og:image fallback, T-140)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('routes a SELLABLE no-watermark first photo through the absolute /api/watermark/ URL', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 10 });
    const path = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(path);
    await createTestPhoto(event.id, { user_id: owner.id, original_url: path });

    const url = await resolveEventOgImageUrl(createServiceClient(), {
      eventId: event.id,
      coverPath: null,
      watermarkEnabled: false,
      pricePerPhoto: 10,
      baseUrl: BASE_URL,
    });

    // The regression: before T-140 the <meta og:image> carried a direct signed
    // full-res original any OG scraper (view-source) could fetch without paying.
    expect(url).toBe(`${BASE_URL}/api/watermark/${path}`);
    expect(url).not.toContain('/storage/v1/object/sign/');
  });

  it('keeps the direct signed original for a genuinely FREE no-watermark event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: null });
    const path = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(path);
    await createTestPhoto(event.id, { user_id: owner.id, original_url: path });

    const url = await resolveEventOgImageUrl(createServiceClient(), {
      eventId: event.id,
      coverPath: null,
      watermarkEnabled: false,
      pricePerPhoto: null,
      baseUrl: BASE_URL,
    });

    expect(url).toContain('/storage/v1/object/sign/');
    expect(url).not.toContain('/api/watermark/');
  });

  it('direct-signs the dedicated cover when set, even for a for-sale event', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 10 });
    const coverPath = `${owner.id}/${event.id}/cover-${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(coverPath);
    // A first photo also exists, but the dedicated cover must win.
    const photoPath = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await createTestPhoto(event.id, { user_id: owner.id, original_url: photoPath });

    const url = await resolveEventOgImageUrl(createServiceClient(), {
      eventId: event.id,
      coverPath,
      watermarkEnabled: true,
      pricePerPhoto: 10,
      baseUrl: BASE_URL,
    });

    expect(url).toContain('/storage/v1/object/sign/');
    // The dedicated cover — not the first photo — is what got signed.
    expect(url).toContain(coverPath);
    expect(url).not.toContain(photoPath);
    expect(url).not.toContain('/api/watermark/');
  });

  it('never uses an unapproved photo — returns null when the only photo is still pending', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: null });
    const path = `${owner.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(path);
    const photo = await createTestPhoto(event.id, { user_id: owner.id, original_url: path });
    // A guest upload awaiting approval (or a rejected photo) must never surface
    // as the public social preview — the public gallery hides it too. Before the
    // approved-only filter, removing the (dead) deleted_at filter let this
    // pending photo become the og:image (full-res direct-signed for free events).
    await createServiceClient()
      .from('photos')
      .update({ upload_status: 'pending' })
      .eq('id', photo.id);

    const url = await resolveEventOgImageUrl(createServiceClient(), {
      eventId: event.id,
      coverPath: null,
      watermarkEnabled: false,
      pricePerPhoto: null,
      baseUrl: BASE_URL,
    });

    expect(url).toBeNull();
  });

  it('returns null when the event has no cover and no photos', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id, { price_per_photo: 10 });

    const url = await resolveEventOgImageUrl(createServiceClient(), {
      eventId: event.id,
      coverPath: null,
      watermarkEnabled: false,
      pricePerPhoto: 10,
      baseUrl: BASE_URL,
    });

    expect(url).toBeNull();
  });
});
