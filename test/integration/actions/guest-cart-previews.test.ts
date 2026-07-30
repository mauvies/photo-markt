/**
 * Integration tests for the guest cart's preview resolution, now served
 * exclusively through `loadGuestCartStateAction` (`src/app/[lang]/cart/actions.ts`).
 *
 * T-115: the guest cart's `previewUrl` snapshot (stashed in `GuestCartItem`
 * at add-to-cart time) is a signed Supabase original that expires after ~1h
 * — a photo added more than an hour ago showed a broken image even though it
 * was still active. Previews are resolved live on every cart load: the baked
 * (immutable, never-expiring) thumbnail when ready, or a freshly-signed
 * original otherwise.
 *
 * T-130 hardening: the old `resolveGuestCartPreviewsAction` — a separately
 * POSTable unauthenticated action that resolved ARBITRARY caller-supplied ids
 * with no purchasability filter — was folded into `loadGuestCartStateAction`,
 * so every anonymous request passes the purchasability gate, the id cap, and
 * an IP rate limit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3000' })),
}));

import { loadGuestCartStateAction } from '@/app/[lang]/cart/actions';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
} from '../../helpers/supabase-test-client';

/** Upload a stub byte at `path` so `createSignedUrl` has a real object to sign. */
async function uploadStubBytes(path: string) {
  await ensurePhotosBucket();
  const sb = createServiceClient();
  await sb.storage
    .from('photos')
    .upload(path, new Uint8Array([0xff]), { contentType: 'image/jpeg', upsert: true });
}

describe('loadGuestCartStateAction — preview resolution', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty state for an empty photo id list', async () => {
    const result = await loadGuestCartStateAction([]);
    // `eventPricing` joined the payload in T-204 — the guest cart needs each
    // event's bundle ladder to price itself with the same kernel checkout uses.
    expect(result).toEqual({
      removedPhotoIds: [],
      previews: {},
      photographers: {},
      eventPricing: {},
    });
  });

  it('resolves the baked thumbnail URL when the thumbnail is ready — never a stale signed URL', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });

    const sb = createServiceClient();
    await sb
      .from('photos')
      .update({ thumbnail_status: 'ready', thumb_version: 3 })
      .eq('id', photo.id);

    const { previews } = await loadGuestCartStateAction([photo.id]);

    expect(previews[photo.id]).toContain('/api/thumb/');
    expect(previews[photo.id]).toContain('?v=3');
    // Never a signed Supabase URL (the thing that goes stale after ~1h).
    expect(previews[photo.id]).not.toContain('/storage/v1/object/sign/');
    expect(previews[photo.id]).not.toBe(originalUrl);
  });

  it('falls back to the watermarked preview route when a watermarked event has not baked yet', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    // Events are watermark_enabled by default (DB default true).
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    // Freshly created photos default to a non-'ready' thumbnail_status.

    const { previews } = await loadGuestCartStateAction([photo.id]);

    expect(previews[photo.id]).toBeTruthy();
    expect(previews[photo.id]).not.toContain('/api/thumb/');
    // T-131: the pre-bake fallback must NOT leak the raw original — it goes
    // through the fail-closed /api/watermark/ route for watermarked events.
    expect(previews[photo.id]).toContain('/api/watermark/');
    expect(previews[photo.id]).not.toContain('/storage/v1/object/sign/');
  });

  it('resolves multiple photos independently by current thumbnail state', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });

    const readyOriginalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    const readyPhoto = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: readyOriginalUrl,
    });

    const pendingOriginalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(pendingOriginalUrl);
    const pendingPhoto = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: pendingOriginalUrl,
    });

    const sb = createServiceClient();
    await sb
      .from('photos')
      .update({ thumbnail_status: 'ready', thumb_version: 1 })
      .eq('id', readyPhoto.id);

    const { previews } = await loadGuestCartStateAction([readyPhoto.id, pendingPhoto.id]);

    expect(previews[readyPhoto.id]).toContain('/api/thumb/');
    expect(previews[pendingPhoto.id]).not.toContain('/api/thumb/');
  });

  it('never resolves a preview for an unpurchasable photo (T-130 hardening)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    await createServiceClient()
      .from('photos')
      .update({ upload_status: 'rejected' })
      .eq('id', photo.id);

    const { previews, removedPhotoIds } = await loadGuestCartStateAction([photo.id]);

    // An anonymous caller must not be able to mint a signed original URL for
    // a photo that isn't purchasable — it's reported as removed instead.
    expect(previews[photo.id]).toBeUndefined();
    expect(removedPhotoIds).toEqual([photo.id]);
  });
});
