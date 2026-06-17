/**
 * Integration tests for `database/queries/photos.ts`.
 *
 * Photos are the product. These tests cover ownership-scoped reads, the
 * public read path, the approved/pending status filter, and create/delete
 * round-trips.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { addOrderItems, createOrder } from '@/database/queries/orders';
import {
  createPhoto,
  deleteEventPhotos,
  deletePhoto,
  getEventPhotos,
  getEventPhotosPublic,
  getPhoto,
  getPhotoStoragePaths,
  getPhotosForEvents,
  getPhotosUploadedCount,
  getSoldPhotoIdsForEvent,
  getStorageUsageBytes,
  updatePhotoUploadStatus,
} from '@/database/queries/photos';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/photos', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // Regression: deleting an event hard-deleted ALL its photos, but a sold
  // photo is referenced by order_items (ON DELETE RESTRICT), so the delete
  // threw a FK violation and the whole event-delete failed.
  describe('deleting event photos with a sold photo', () => {
    async function seedEventWithOneSoldPhoto() {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id, { price_per_photo: 3 });
      const sold = await createTestPhoto(event.id);
      const unsold = await createTestPhoto(event.id);
      const talent = await createTestUser('TALENT');
      const sb = createServiceClient();
      const order = await createOrder(sb, talent.id, {
        total_amount_cents: 300,
        status: 'completed',
      });
      await addOrderItems(sb, order.id, [
        { photo_id: sold.id, photographer_id: photographer.id, unit_price_cents: 300 },
      ]);
      return { photographer, event, sold, unsold, sb };
    }

    it('getSoldPhotoIdsForEvent returns only the purchased photo', async () => {
      const { event, sold, sb } = await seedEventWithOneSoldPhoto();
      const ids = await getSoldPhotoIdsForEvent(sb, event.id);
      expect(ids).toEqual([sold.id]);
    });

    it('without excluding the sold photo, the delete throws the FK violation', async () => {
      const { event, photographer, sb } = await seedEventWithOneSoldPhoto();
      await expect(deleteEventPhotos(sb, event.id, photographer.id)).rejects.toThrow(
        /foreign key|order_items/i,
      );
    });

    it('excluding sold photos deletes the rest and keeps the sold row + its storage path', async () => {
      const { event, photographer, sold, unsold, sb } = await seedEventWithOneSoldPhoto();
      const soldIds = await getSoldPhotoIdsForEvent(sb, event.id);

      await expect(
        deleteEventPhotos(sb, event.id, photographer.id, soldIds),
      ).resolves.not.toThrow();

      // Sold photo survives, unsold is gone.
      expect((await getPhoto(sb, sold.id, event.id, photographer.id))?.id).toBe(sold.id);
      expect(await getPhoto(sb, unsold.id, event.id, photographer.id)).toBeNull();

      // Storage paths exclude the sold photo so the buyer keeps download access.
      const paths = await getPhotoStoragePaths(sb, event.id, photographer.id, soldIds);
      const soldRow = await getPhoto(sb, sold.id, event.id, photographer.id);

      expect(paths).not.toContain(soldRow?.original_url);
    });
  });

  describe('getPhoto', () => {
    it('returns the photo when owner asks', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const photo = await createTestPhoto(event.id);
      const found = await getPhoto(createServiceClient(), photo.id, event.id, owner.id);

      expect(found?.id).toBe(photo.id);
    });

    it('returns null when (event, user) mismatch', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const photo = await createTestPhoto(event.id);
      const found = await getPhoto(createServiceClient(), photo.id, event.id, stranger.id);

      expect(found).toBeNull();
    });
  });

  describe('getEventPhotos', () => {
    it('returns only approved photos by default', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      const approved = await createTestPhoto(event.id);
      // Seed a pending photo by inserting directly.
      await sb.from('photos').insert({
        user_id: owner.id,
        event_id: event.id,
        original_url: `${owner.id}/${event.id}/pending.jpg`,
        upload_status: 'pending',
        city: 'Barcelona',
        country: 'ES',
        taken_at: new Date().toISOString(),
      });

      const photos = await getEventPhotos(sb, event.id, owner.id);

      expect(photos).toHaveLength(1);
      expect(photos[0].id).toBe(approved.id);
    });

    it("returns the pending queue when status: 'pending' is requested", async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      // One approved + one pending.
      await createTestPhoto(event.id);
      await sb.from('photos').insert({
        user_id: owner.id,
        event_id: event.id,
        original_url: `${owner.id}/${event.id}/pending.jpg`,
        upload_status: 'pending',
        city: 'Barcelona',
        country: 'ES',
        taken_at: new Date().toISOString(),
      });

      const pending = await getEventPhotos(sb, event.id, owner.id, { status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].upload_status).toBe('pending');
    });

    it('respects ownership unless skipUserIdFilter is true', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      await createTestPhoto(event.id);

      const sb = createServiceClient();
      // Default: filter by user_id → stranger sees nothing.
      const asStranger = await getEventPhotos(sb, event.id, stranger.id);
      expect(asStranger).toHaveLength(0);

      // skipUserIdFilter: collaborative-event path, returns everything.
      const skipFilter = await getEventPhotos(sb, event.id, stranger.id, {
        skipUserIdFilter: true,
      });
      expect(skipFilter).toHaveLength(1);
    });
  });

  describe('getEventPhotosPublic', () => {
    it('returns approved photos without any owner check', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      await createTestPhoto(event.id);
      await createTestPhoto(event.id);

      const photos = await getEventPhotosPublic(createServiceClient(), event.id);
      expect(photos).toHaveLength(2);
    });

    it('omits pending photos', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      await createTestPhoto(event.id); // approved
      await sb.from('photos').insert({
        user_id: owner.id,
        event_id: event.id,
        original_url: `${owner.id}/${event.id}/pending.jpg`,
        upload_status: 'pending',
        city: 'Barcelona',
        country: 'ES',
        taken_at: new Date().toISOString(),
      });

      const photos = await getEventPhotosPublic(sb, event.id);
      expect(photos).toHaveLength(1);
    });
  });

  describe('getPhotosForEvents', () => {
    it('aggregates approved photos across multiple events', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const eventA = await createTestEvent(owner.id);
      const eventB = await createTestEvent(owner.id);
      await createTestPhoto(eventA.id);
      await createTestPhoto(eventA.id);
      await createTestPhoto(eventB.id);

      const photos = await getPhotosForEvents(createServiceClient(), [eventA.id, eventB.id]);
      expect(photos).toHaveLength(3);
    });

    it('returns an empty array for an empty input list (no query)', async () => {
      const photos = await getPhotosForEvents(createServiceClient(), []);
      expect(photos).toEqual([]);
    });
  });

  describe('createPhoto + deletePhoto + updatePhotoUploadStatus', () => {
    it('createPhoto inserts and is visible via getEventPhotos', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      await createPhoto(sb, owner.id, {
        event_id: event.id,
        original_url: `${owner.id}/${event.id}/new.jpg`,
        taken_at: new Date().toISOString(),
        city: 'Barcelona',
        country: 'ES',
        state: 'Catalonia',
        size_bytes: 1024,
      });

      const photos = await getEventPhotos(sb, event.id, owner.id);
      expect(photos).toHaveLength(1);
    });

    it('updatePhotoUploadStatus flips approved/pending', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      const { id } = await createTestPhoto(event.id);

      await updatePhotoUploadStatus(sb, { photoId: id, eventId: event.id, status: 'pending' });
      const { data } = await sb.from('photos').select('upload_status').eq('id', id).single();
      expect(data?.upload_status).toBe('pending');

      await updatePhotoUploadStatus(sb, { photoId: id, eventId: event.id, status: 'approved' });
      const { data: after } = await sb.from('photos').select('upload_status').eq('id', id).single();
      expect(after?.upload_status).toBe('approved');
    });

    it('getPhotosUploadedCount and getStorageUsageBytes ignore soft-deleted events', async () => {
      // Regression for the "85 uploaded / 45 visible" discrepancy: photos
      // attached to a soft-deleted event must not inflate the photographer's
      // counter or storage meter. Both queries join `events!inner` and
      // filter `deleted_at IS NULL` — this asserts that.
      const owner = await createTestUser('PHOTOGRAPHER');
      const activeEvent = await createTestEvent(owner.id);
      const softDeletedEvent = await createTestEvent(owner.id);
      const sb = createServiceClient();

      // 5 photos in the active event (1_000 bytes each → 5_000 total).
      for (let i = 0; i < 5; i += 1) {
        await sb.from('photos').insert({
          user_id: owner.id,
          event_id: activeEvent.id,
          original_url: `${owner.id}/${activeEvent.id}/active-${i}.jpg`,
          taken_at: new Date().toISOString(),
          city: 'Barcelona',
          country: 'ES',
          size_bytes: 1000,
        });
      }

      // 2 photos in an event that's about to be soft-deleted (9_999 bytes
      // each → if the join filter is missing, getStorageUsageBytes would
      // return 5_000 + 19_998 = 24_998 instead of 5_000).
      for (let i = 0; i < 2; i += 1) {
        await sb.from('photos').insert({
          user_id: owner.id,
          event_id: softDeletedEvent.id,
          original_url: `${owner.id}/${softDeletedEvent.id}/stale-${i}.jpg`,
          taken_at: new Date().toISOString(),
          city: 'Barcelona',
          country: 'ES',
          size_bytes: 9999,
        });
      }

      await sb
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', softDeletedEvent.id);

      expect(await getPhotosUploadedCount(sb, owner.id)).toBe(5);
      expect(await getStorageUsageBytes(sb, owner.id)).toBe(5000);
    });

    it('rejects inserting a photo with a null event_id (orphan guard)', async () => {
      // Verifies the `photos_event_id_not_null` CHECK constraint added in
      // migration 20260520000002 — no new row may be created without an
      // event, so the orphan class can't recur.
      const owner = await createTestUser('PHOTOGRAPHER');
      const sb = createServiceClient();
      const { error } = await sb.from('photos').insert({
        user_id: owner.id,
        event_id: null,
        original_url: `${owner.id}/orphan.jpg`,
        taken_at: new Date().toISOString(),
        city: 'Barcelona',
        country: 'ES',
      });

      expect(error).not.toBeNull();
    });

    it('deletePhoto removes the row', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const sb = createServiceClient();
      const { id } = await createTestPhoto(event.id);

      await deletePhoto(sb, id, owner.id);

      const { count } = await sb
        .from('photos')
        .select('*', { count: 'exact', head: true })
        .eq('id', id);

      expect(count).toBe(0);
    });
  });
});
