/**
 * Integration tests for `database/queries/events.ts`.
 *
 * These exercise the actual query functions against a real local Supabase.
 * `getEventBySlug` is covered in `test/integration/example.test.ts` — this
 * file fills in the rest of the public surface.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEvent,
  deleteEvent,
  eventExists,
  getEvent,
  getEventByShareCode,
  getUserEvents,
  updateEvent,
} from '@/database/queries/events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/events', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('getEvent', () => {
    it('returns the event when caller owns it', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      const found = await getEvent(createServiceClient(), event.id, owner.id);
      expect(found?.id).toBe(event.id);
    });

    it('throws when the caller does not own the event', async () => {
      // Note: getEvent uses `.single().throwOnError()` so "not found" surfaces
      // as a throw, not a null return — even though the type signature says
      // `Event | null`. Documenting the real behaviour here keeps callers
      // honest about needing try/catch.
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      await expect(getEvent(createServiceClient(), event.id, stranger.id)).rejects.toThrow();
    });

    it('throws for a non-existent id', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      await expect(
        getEvent(createServiceClient(), '00000000-0000-0000-0000-000000000000', owner.id),
      ).rejects.toThrow();
    });
  });

  describe('eventExists', () => {
    it('returns true only for an event the caller owns', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      expect(await eventExists(createServiceClient(), event.id, owner.id)).toBe(true);
    });

    it('returns false when the event id belongs to someone else', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      expect(await eventExists(createServiceClient(), event.id, stranger.id)).toBe(false);
    });

    it('returns false for a non-existent id', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      expect(
        await eventExists(createServiceClient(), '00000000-0000-0000-0000-000000000000', owner.id),
      ).toBe(false);
    });
  });

  describe('getEventByShareCode', () => {
    it('returns the event for a known share code', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id, { share_code: 'ABCD1234' });
      const found = await getEventByShareCode(createServiceClient(), 'ABCD1234');
      expect(found?.id).toBe(event.id);
    });

    it('returns null for an unknown share code', async () => {
      expect(await getEventByShareCode(createServiceClient(), 'NOPE9999')).toBeNull();
    });
  });

  describe('getUserEvents', () => {
    it('returns only events owned by the user', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      await createTestEvent(owner.id, { name: 'Mine A' });
      await createTestEvent(owner.id, { name: 'Mine B' });
      await createTestEvent(stranger.id, { name: 'Not Mine' });

      const events = await getUserEvents(createServiceClient(), owner.id);
      // user_id isn't in EventSummary's SELECT, so we assert by name + count.
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.name).sort()).toEqual(['Mine A', 'Mine B']);
    });

    it('returns an empty array when the user has no events', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const events = await getUserEvents(createServiceClient(), owner.id);
      expect(events).toEqual([]);
    });
  });

  describe('createEvent + updateEvent + deleteEvent', () => {
    it('creates an event with the supplied fields', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const created = await createEvent(createServiceClient(), owner.id, {
        name: 'Photo Sprint 2026',
        date: '2026-09-01',
        city: 'Madrid',
        country: 'ES',
        state: 'Madrid',
        activity: 'SURF',
        is_public: true,
        share_code: 'SPRINT26',
        price_per_photo: null,
        watermark_enabled: false,
      });
      expect(created.id).toBeDefined();
      // createEvent's return type only includes `id` — re-fetch to assert the rest.
      const { data: row } = await createServiceClient()
        .from('events')
        .select('user_id, name')
        .eq('id', created.id)
        .single();
      expect(row?.user_id).toBe(owner.id);
      expect(row?.name).toBe('Photo Sprint 2026');
    });

    it('persists and clears the optional session_time (T-106)', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const created = await createEvent(createServiceClient(), owner.id, {
        name: 'Dawn Session',
        date: '2026-09-01',
        session_time: '06:45',
        city: 'Madrid',
        country: 'ES',
        state: 'Madrid',
        activity: 'SURF',
        is_public: true,
        share_code: 'DAWN26',
        price_per_photo: null,
        watermark_enabled: false,
      });

      const { data: created_row } = await createServiceClient()
        .from('events')
        .select('session_time')
        .eq('id', created.id)
        .single();
      // Postgres `time` serializes as "HH:MM:SS".
      expect(created_row?.session_time).toBe('06:45:00');

      // Clearing it (null) persists.
      await updateEvent(createServiceClient(), created.id, owner.id, { session_time: null });
      const { data: cleared_row } = await createServiceClient()
        .from('events')
        .select('session_time')
        .eq('id', created.id)
        .single();
      expect(cleared_row?.session_time).toBeNull();
    });

    it('updates only the supplied columns', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id, { name: 'Old Name' });

      await updateEvent(createServiceClient(), event.id, owner.id, { name: 'New Name' });

      const after = await getEvent(createServiceClient(), event.id, owner.id);
      expect(after?.name).toBe('New Name');
    });

    it('soft-deletes via deleteEvent (deleted_at populated, row stays)', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);

      await deleteEvent(createServiceClient(), event.id, owner.id);

      // getEvent filters by `deleted_at IS NULL` and throws on no-row.
      await expect(getEvent(createServiceClient(), event.id, owner.id)).rejects.toThrow();

      // But the row is still in the table (soft delete, not hard delete).
      const { data: rawRow } = await createServiceClient()
        .from('events')
        .select('id, deleted_at')
        .eq('id', event.id)
        .maybeSingle();
      expect(rawRow?.deleted_at).not.toBeNull();
    });
  });
});
