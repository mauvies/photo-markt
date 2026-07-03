/**
 * Integration tests for the talent bib-search Server Action (T-032)
 * in `app/[lang]/events/[shareCode]/actions.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));

import { searchPhotosByBibInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import { persistPhotoBibs, updateEventBibDetectionState } from '@/database/queries/bib-numbers';
import {
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

async function seedEvent(opts: { shareCode: string; enabled: boolean }) {
  const owner = await createTestUser('PHOTOGRAPHER');
  const event = await createTestEvent(owner.id, { share_code: opts.shareCode, is_public: true });
  const sb = createServiceClient();
  if (opts.enabled) await updateEventBibDetectionState(sb, event.id, { enabled: true });
  return { owner, event, sb };
}

describe('searchPhotosByBibInEvent (T-032)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns the matching public photo ids on an opted-in event', async () => {
    const { event, sb } = await seedEvent({ shareCode: 'BIBA', enabled: true });
    const match = await createTestPhoto(event.id);
    const other = await createTestPhoto(event.id);
    await persistPhotoBibs(sb, match.id, [{ bibText: '1432', confidence: 99 }]);
    await persistPhotoBibs(sb, other.id, [{ bibText: '88', confidence: 99 }]);

    const res = await searchPhotosByBibInEvent('BIBA', '1432');
    expect(res.photoIds).toEqual([match.id]);
  });

  it('normalizes the query so "#1432." matches "1432"', async () => {
    const { event, sb } = await seedEvent({ shareCode: 'BIBB', enabled: true });
    const match = await createTestPhoto(event.id);
    await persistPhotoBibs(sb, match.id, [{ bibText: '1432', confidence: 99 }]);

    const res = await searchPhotosByBibInEvent('BIBB', '  #1432. ');
    expect(res.photoIds).toEqual([match.id]);
  });

  it('returns empty for a bib with no matches', async () => {
    await seedEvent({ shareCode: 'BIBC', enabled: true });
    expect((await searchPhotosByBibInEvent('BIBC', '9999')).photoIds).toEqual([]);
  });

  it('throws when bib detection is not enabled on the event', async () => {
    await seedEvent({ shareCode: 'BIBD', enabled: false });
    await expect(searchPhotosByBibInEvent('BIBD', '1432')).rejects.toThrow(/does not support/i);
  });

  // Regression (T-062): public-only events have share_code = null and are
  // opened by their SEO slug. The action used to resolve strictly by share
  // code, so slug lookups threw "Event not found." It must now resolve by slug.
  it('resolves a public event by slug when it has no share code', async () => {
    const owner = await createTestUser('PHOTOGRAPHER');
    const sb = createServiceClient();
    const event = await createTestEvent(owner.id, { slug: 'bib-public-slug', is_public: true });
    // Model a public-only event: no share code, opened by slug.
    await sb.from('events').update({ share_code: null }).eq('id', event.id);
    await updateEventBibDetectionState(sb, event.id, { enabled: true });

    const match = await createTestPhoto(event.id);
    await persistPhotoBibs(sb, match.id, [{ bibText: '1432', confidence: 99 }]);

    const res = await searchPhotosByBibInEvent('bib-public-slug', '1432');
    expect(res.photoIds).toEqual([match.id]);
  });
});
