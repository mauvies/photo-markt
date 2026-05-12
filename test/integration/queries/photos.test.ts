/**
 * Integration tests for `database/queries/photos.ts`.
 *
 * Photos are the product. These tests cover ownership-scoped reads, the
 * public read path, the approved/pending status filter, and create/delete
 * round-trips.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPhoto,
  deletePhoto,
  getEventPhotos,
  getEventPhotosPublic,
  getPhoto,
  getPhotosForEvents,
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
