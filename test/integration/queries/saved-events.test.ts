import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSavedEventIdsForTalent,
  getSavedEventsCountForTalent,
  getSavedEventsForTalent,
  isEventSavedByTalent,
  saveEventForTalent,
  unsaveEventForTalent,
  updateLastSeenAt,
} from '@/database/queries/saved-events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function setupFixtures() {
  const photographer = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(photographer.id);
  const talent = await createTestUser('TALENT');
  return { photographer, event, talent };
}

describe('database/queries/saved-events', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('saveEventForTalent + isEventSavedByTalent', () => {
    it('saves an event and reports it as saved', async () => {
      const { event, talent } = await setupFixtures();
      const sb = createServiceClient();
      await saveEventForTalent(sb, talent.id, event.id);
      expect(await isEventSavedByTalent(sb, talent.id, event.id)).toBe(true);
    });

    it('is idempotent — a second save is a silent no-op (handled 23505)', async () => {
      const { event, talent } = await setupFixtures();
      const sb = createServiceClient();
      await saveEventForTalent(sb, talent.id, event.id);
      await expect(saveEventForTalent(sb, talent.id, event.id)).resolves.not.toThrow();
      expect(await getSavedEventsCountForTalent(sb, talent.id)).toBe(1);
    });

    it('isEventSavedByTalent returns false when not saved', async () => {
      const { event, talent } = await setupFixtures();
      expect(await isEventSavedByTalent(createServiceClient(), talent.id, event.id)).toBe(false);
    });
  });

  describe('unsaveEventForTalent', () => {
    it('removes a saved event', async () => {
      const { event, talent } = await setupFixtures();
      const sb = createServiceClient();
      await saveEventForTalent(sb, talent.id, event.id);
      await unsaveEventForTalent(sb, talent.id, event.id);
      expect(await isEventSavedByTalent(sb, talent.id, event.id)).toBe(false);
    });
  });

  describe('getSavedEventIdsForTalent', () => {
    it('returns only the calling talent ids', async () => {
      const { photographer, talent } = await setupFixtures();
      const sb = createServiceClient();
      const eventA = await createTestEvent(photographer.id);
      const eventB = await createTestEvent(photographer.id);
      const other = await createTestUser('TALENT');
      const eventC = await createTestEvent(photographer.id);

      await saveEventForTalent(sb, talent.id, eventA.id);
      await saveEventForTalent(sb, talent.id, eventB.id);
      await saveEventForTalent(sb, other.id, eventC.id);

      const ids = await getSavedEventIdsForTalent(sb, talent.id);
      expect(ids.sort()).toEqual([eventA.id, eventB.id].sort());
    });
  });

  describe('getSavedEventsForTalent', () => {
    it('returns saved events, newest-saved first', async () => {
      const { photographer, talent } = await setupFixtures();
      const sb = createServiceClient();
      const eventA = await createTestEvent(photographer.id);
      const eventB = await createTestEvent(photographer.id);
      await saveEventForTalent(sb, talent.id, eventA.id);
      await saveEventForTalent(sb, talent.id, eventB.id);

      const rows = await getSavedEventsForTalent(sb, talent.id);
      expect(rows).toHaveLength(2);
      // eventB saved last → first.
      expect(rows[0].event_id).toBe(eventB.id);
      expect(rows[1].event_id).toBe(eventA.id);
    });

    it('excludes soft-deleted events', async () => {
      const { event, talent } = await setupFixtures();
      const sb = createServiceClient();
      await saveEventForTalent(sb, talent.id, event.id);

      await sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id);

      const rows = await getSavedEventsForTalent(sb, talent.id);
      expect(rows).toHaveLength(0);
      // Count helper agrees so "Load more" / hasMore stays correct.
      expect(await getSavedEventsCountForTalent(sb, talent.id)).toBe(0);
    });

    it('paginates via limit/offset', async () => {
      const { photographer, talent } = await setupFixtures();
      const sb = createServiceClient();
      for (let i = 0; i < 3; i++) {
        const e = await createTestEvent(photographer.id);
        await saveEventForTalent(sb, talent.id, e.id);
      }
      const firstPage = await getSavedEventsForTalent(sb, talent.id, { limit: 2, offset: 0 });
      const secondPage = await getSavedEventsForTalent(sb, talent.id, { limit: 2, offset: 2 });
      expect(firstPage).toHaveLength(2);
      expect(secondPage).toHaveLength(1);
    });
  });

  describe('updateLastSeenAt', () => {
    it('stamps last_seen_at on a saved event', async () => {
      const { event, talent } = await setupFixtures();
      const sb = createServiceClient();
      await saveEventForTalent(sb, talent.id, event.id);

      await updateLastSeenAt(sb, talent.id, event.id);

      const { data } = await sb
        .from('talent_saved_events')
        .select('last_seen_at')
        .eq('user_id', talent.id)
        .eq('event_id', event.id)
        .single();
      expect(data?.last_seen_at).not.toBeNull();
    });
  });
});
