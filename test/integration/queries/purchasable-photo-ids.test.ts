/**
 * Integration tests for `getPurchasablePhotoIds` (`src/database/queries/photos.ts`).
 *
 * T-117: the single source of truth for "is this photo currently purchasable"
 * — used by guest-cart validation, the authenticated cart's self-heal-on-load,
 * and both checkout paths' pre-charge re-validation. A photo is purchasable
 * iff its row exists, `upload_status = 'approved'`, and its event's
 * `deleted_at` is null.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getPurchasablePhotoIds } from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('getPurchasablePhotoIds', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty set for an empty input', async () => {
    const sb = createServiceClient();
    const result = await getPurchasablePhotoIds(sb, []);
    expect(result).toEqual(new Set());
  });

  it('includes a fully-purchasable photo (approved, event alive)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });

    const result = await getPurchasablePhotoIds(createServiceClient(), [photo.id]);

    expect(result.has(photo.id)).toBe(true);
  });

  it('excludes a hard-deleted photo id (no row at all)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const sb = createServiceClient();
    await sb.from('photos').delete().eq('id', photo.id);

    const result = await getPurchasablePhotoIds(sb, [photo.id]);

    expect(result.has(photo.id)).toBe(false);
  });

  it('excludes a photo whose event was soft-deleted (events.deleted_at)', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const sb = createServiceClient();
    await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

    const result = await getPurchasablePhotoIds(sb, [photo.id]);

    expect(result.has(photo.id)).toBe(false);
  });

  it("excludes a photo that isn't approved (pending/rejected)", async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const sb = createServiceClient();
    await sb.from('photos').update({ upload_status: 'rejected' }).eq('id', photo.id);

    const result = await getPurchasablePhotoIds(sb, [photo.id]);

    expect(result.has(photo.id)).toBe(false);
  });

  it('resolves a mixed batch independently', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const goodEvent = await createTestEvent(photographer.id);
    const deadEvent = await createTestEvent(photographer.id);
    const goodPhoto = await createTestPhoto(goodEvent.id, { user_id: photographer.id });
    const rejectedPhoto = await createTestPhoto(goodEvent.id, { user_id: photographer.id });
    const orphanedPhoto = await createTestPhoto(deadEvent.id, { user_id: photographer.id });

    const sb = createServiceClient();
    await sb.from('photos').update({ upload_status: 'rejected' }).eq('id', rejectedPhoto.id);
    await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', deadEvent.id);

    const result = await getPurchasablePhotoIds(sb, [
      goodPhoto.id,
      rejectedPhoto.id,
      orphanedPhoto.id,
    ]);

    expect(result.has(goodPhoto.id)).toBe(true);
    expect(result.has(rejectedPhoto.id)).toBe(false);
    expect(result.has(orphanedPhoto.id)).toBe(false);
  });
});
