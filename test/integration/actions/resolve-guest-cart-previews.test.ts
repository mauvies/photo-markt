/**
 * Integration tests for `resolveGuestCartPreviewsAction`
 * (`src/app/[lang]/cart/actions.ts`).
 *
 * T-115: the guest cart's `previewUrl` snapshot (stashed in `GuestCartItem`
 * at add-to-cart time) is a signed Supabase original that expires after ~1h
 * — a photo added more than an hour ago showed a broken image even though it
 * was still active. This action resolves the CURRENT preview live, on every
 * cart load: the baked (immutable, never-expiring) thumbnail when ready, or
 * a freshly-signed original otherwise.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveGuestCartPreviewsAction } from '@/app/[lang]/cart/actions';
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

describe('resolveGuestCartPreviewsAction', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty map for an empty photo id list', async () => {
    const result = await resolveGuestCartPreviewsAction([]);
    expect(result).toEqual({});
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

    const result = await resolveGuestCartPreviewsAction([photo.id]);

    expect(result[photo.id]).toContain('/api/thumb/');
    expect(result[photo.id]).toContain('?v=3');
    // Never a signed Supabase URL (the thing that goes stale after ~1h).
    expect(result[photo.id]).not.toContain('/storage/v1/object/sign/');
    expect(result[photo.id]).not.toBe(originalUrl);
  });

  it('falls back to a freshly-signed original when the thumbnail has not baked yet', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id, { price_per_photo: 10 });
    const originalUrl = `${photographer.id}/${event.id}/${crypto.randomUUID()}.jpg`;
    await uploadStubBytes(originalUrl);
    const photo = await createTestPhoto(event.id, {
      user_id: photographer.id,
      original_url: originalUrl,
    });
    // Freshly created photos default to a non-'ready' thumbnail_status.

    const result = await resolveGuestCartPreviewsAction([photo.id]);

    expect(result[photo.id]).toBeTruthy();
    expect(result[photo.id]).not.toContain('/api/thumb/');
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

    const result = await resolveGuestCartPreviewsAction([readyPhoto.id, pendingPhoto.id]);

    expect(result[readyPhoto.id]).toContain('/api/thumb/');
    expect(result[pendingPhoto.id]).not.toContain('/api/thumb/');
  });
});
