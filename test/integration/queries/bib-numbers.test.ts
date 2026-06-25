/**
 * Integration tests for `database/queries/bib-numbers.ts` (T-032).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  bulkSetPhotoBibDetectionStatus,
  countEventPhotosBibInFlight,
  getEventBibDetectionState,
  getPhotoIdsByBibInEvent,
  persistPhotoBibs,
  updateEventBibDetectionState,
  updatePhotoBibDetectionStatus,
} from '@/database/queries/bib-numbers';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('database/queries/bib-numbers', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('event state', () => {
    it('defaults to disabled/idle and round-trips updates', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id);
      const sb = createServiceClient();

      const initial = await getEventBibDetectionState(sb, event.id);
      expect(initial).toMatchObject({ enabled: false, status: 'idle' });

      await updateEventBibDetectionState(sb, event.id, { enabled: true, status: 'detecting' });
      expect(await getEventBibDetectionState(sb, event.id)).toMatchObject({
        enabled: true,
        status: 'detecting',
      });
    });
  });

  describe('persistPhotoBibs', () => {
    it('persists bibs and is idempotent on (photo_id, bib_text)', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id);
      const photo = await createTestPhoto(event.id);
      const sb = createServiceClient();

      await persistPhotoBibs(sb, photo.id, [{ bibText: '1432', confidence: 99 }]);
      await persistPhotoBibs(sb, photo.id, [{ bibText: '1432', confidence: 99 }]); // retry

      const { count } = await sb
        .from('photo_bib_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('photo_id', photo.id);
      expect(count).toBe(1);
    });
  });

  describe('getPhotoIdsByBibInEvent', () => {
    it('returns only photos in the event with an exact bib match', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const eventA = await createTestEvent(photographer.id);
      const eventB = await createTestEvent(photographer.id);
      const matchA = await createTestPhoto(eventA.id);
      const otherA = await createTestPhoto(eventA.id);
      const matchB = await createTestPhoto(eventB.id);
      const sb = createServiceClient();

      await persistPhotoBibs(sb, matchA.id, [{ bibText: '1432', confidence: 99 }]);
      await persistPhotoBibs(sb, otherA.id, [{ bibText: '88', confidence: 99 }]);
      await persistPhotoBibs(sb, matchB.id, [{ bibText: '1432', confidence: 99 }]); // same bib, other event

      const hits = await getPhotoIdsByBibInEvent(sb, eventA.id, '1432');
      expect(hits).toEqual([matchA.id]);
    });

    it('returns empty for a bib with no matches', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id);
      expect(await getPhotoIdsByBibInEvent(createServiceClient(), event.id, '9999')).toEqual([]);
    });
  });

  describe('countEventPhotosBibInFlight', () => {
    it('counts only pending/detecting photos', async () => {
      const photographer = await createTestUser('PHOTOGRAPHER');
      const event = await createTestEvent(photographer.id);
      const a = await createTestPhoto(event.id);
      const b = await createTestPhoto(event.id);
      const c = await createTestPhoto(event.id);
      const sb = createServiceClient();

      await bulkSetPhotoBibDetectionStatus(sb, [a.id, b.id], 'pending');
      await updatePhotoBibDetectionStatus(sb, b.id, 'detecting');
      await updatePhotoBibDetectionStatus(sb, c.id, 'detected');

      expect(await countEventPhotosBibInFlight(sb, event.id)).toBe(2);
    });
  });
});
