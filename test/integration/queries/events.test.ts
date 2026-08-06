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

    // T-235. These three used to assert `rejects.toThrow()`, with a comment
    // calling that "the real behaviour" callers must write try/catch around.
    // It was the bug: `.single().throwOnError()` re-threw PostgREST's PGRST116
    // before the error-mapping branch, so the declared `Event | null` could
    // never be null and the `if (!event)` guard in all eight callers was dead
    // code. In production a photographer re-indexing an event saw "Cannot
    // coerce the result to a single JSON object".
    it('returns null when the caller does not own the event', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const stranger = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(owner.id);
      expect(await getEvent(createServiceClient(), event.id, stranger.id)).toBeNull();
    });

    it('returns null for a non-existent id', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      expect(
        await getEvent(createServiceClient(), '00000000-0000-0000-0000-000000000000', owner.id),
      ).toBeNull();
    });

    // The soft-deleted case is covered end-to-end through the real delete path
    // in the `deleteEvent` block below, so it isn't repeated here.
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
        .select('user_id, name, city, state, country')
        .eq('id', created.id)
        .single();
      expect(row?.user_id).toBe(owner.id);
      expect(row?.name).toBe('Photo Sprint 2026');
      // City, state and country persist as three separate columns (T-107).
      expect(row?.city).toBe('Madrid');
      expect(row?.state).toBe('Madrid');
      expect(row?.country).toBe('ES');
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

    it('persists and clears the optional session_end_time (T-180)', async () => {
      const owner = await createTestUser('PHOTOGRAPHER');
      const created = await createEvent(createServiceClient(), owner.id, {
        name: 'Ranged Session',
        date: '2026-09-01',
        session_time: '09:30',
        session_end_time: '12:00',
        city: 'Madrid',
        country: 'ES',
        state: 'Madrid',
        activity: 'SURF',
        is_public: true,
        share_code: 'RANGE26',
        price_per_photo: null,
        watermark_enabled: false,
      });

      const { data: created_row } = await createServiceClient()
        .from('events')
        .select('session_time, session_end_time')
        .eq('id', created.id)
        .single();
      // Postgres `time` serializes as "HH:MM:SS".
      expect(created_row?.session_time).toBe('09:30:00');
      expect((created_row as { session_end_time?: string | null })?.session_end_time).toBe(
        '12:00:00',
      );

      // Clearing only the end (null) persists and leaves the start intact.
      await updateEvent(createServiceClient(), created.id, owner.id, { session_end_time: null });
      const { data: cleared_row } = await createServiceClient()
        .from('events')
        .select('session_time, session_end_time')
        .eq('id', created.id)
        .single();
      expect((cleared_row as { session_end_time?: string | null })?.session_end_time).toBeNull();
      expect(cleared_row?.session_time).toBe('09:30:00');
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

      // getEvent filters by `deleted_at IS NULL`, so a soft-deleted event reads
      // as absent — as `null`, since T-235, not as a thrown PGRST116.
      expect(await getEvent(createServiceClient(), event.id, owner.id)).toBeNull();

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
