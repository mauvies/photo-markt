/**
 * Integration test for `eventHasAnyBibNumbers` (T-069) — the signal that drives
 * the talent bib-search empty state ("still processing" vs "no match").
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eventHasAnyBibNumbers, persistPhotoBibs } from '@/database/queries/bib-numbers';
import type { SupabaseServerClient } from '@/database/queries/types';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

describe('eventHasAnyBibNumbers (T-069)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('is false for an event with no detected bibs', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    await createTestPhoto(event.id);
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    expect(await eventHasAnyBibNumbers(sb, event.id)).toBe(false);
  });

  it('is true once at least one photo has a detected bib', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(owner.id);
    const photo = await createTestPhoto(event.id);
    const sb = createServiceClient();
    await persistPhotoBibs(sb as unknown as SupabaseServerClient, photo.id, [
      { bibText: '1432', confidence: 99 },
    ]);
    expect(await eventHasAnyBibNumbers(sb as unknown as SupabaseServerClient, event.id)).toBe(true);
  });

  it('does not leak bibs from other events', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const withBib = await createTestEvent(owner.id);
    const without = await createTestEvent(owner.id);
    const photo = await createTestPhoto(withBib.id);
    const sb = createServiceClient() as unknown as SupabaseServerClient;
    await persistPhotoBibs(sb, photo.id, [{ bibText: '77', confidence: 99 }]);
    expect(await eventHasAnyBibNumbers(sb, without.id)).toBe(false);
  });
});
