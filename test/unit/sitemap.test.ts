/**
 * Tests for the XML sitemap (`src/app/sitemap.ts`).
 *
 * Characterization (content must stay identical): the sitemap lists the three
 * static pages plus one URL per public, non-deleted event, using the slug when
 * present and the id as fallback.
 *
 * Regression (F-04, caching audit T-083): the events query must run cached and
 * tagged `events-public` — before this fix `sitemap()` scanned the whole
 * `events` table on every crawler request with no `next/cache` involvement, so
 * `cacheTag`/`cacheLife` were never called.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheTag, cacheLife, from, select, eq, is, order } = vi.hoisted(() => {
  const order = vi.fn();
  const is = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ is }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { cacheTag: vi.fn(), cacheLife: vi.fn(), from, select, eq, is, order };
});

vi.mock('next/cache', () => ({ cacheTag, cacheLife }));
// Mock the Supabase query builder chain: from().select().eq().is().order().
vi.mock('@/database/supabase-admin', () => ({ supabaseAdmin: { from } }));

import sitemap, { buildSitemapEntries, type SitemapEvent } from '@/app/sitemap';

const SITE = 'https://photomarkt.com';

describe('buildSitemapEntries', () => {
  it('lists the three static pages with their fixed priorities', () => {
    const entries = buildSitemapEntries(SITE, []);
    expect(entries.map((e) => e.url)).toEqual([SITE, `${SITE}/events`, `${SITE}/pricing`]);
    expect(entries[0].priority).toBe(1);
    expect(entries[1].priority).toBe(0.8);
    expect(entries[2].priority).toBe(0.7);
  });

  it('appends one daily-priority URL per event — slug when present, id as fallback', () => {
    const events: SitemapEvent[] = [
      { id: 'id-1', slug: 'marathon-2026', updated_at: '2026-01-02T00:00:00.000Z' },
      { id: 'id-2', slug: null, updated_at: null },
    ];
    const eventEntries = buildSitemapEntries(SITE, events).slice(3);

    expect(eventEntries[0]).toMatchObject({
      url: `${SITE}/events/marathon-2026`,
      changeFrequency: 'daily',
      priority: 0.9,
    });
    expect(eventEntries[0].lastModified).toEqual(new Date('2026-01-02T00:00:00.000Z'));

    // slug missing → falls back to the event id; no updated_at → a live Date.
    expect(eventEntries[1].url).toBe(`${SITE}/events/id-2`);
    expect(eventEntries[1].lastModified).toBeInstanceOf(Date);
  });
});

describe('sitemap()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.mockResolvedValue({
      data: [{ id: 'id-1', slug: 's-1', updated_at: '2026-01-01T00:00:00.000Z' }],
    });
  });

  it('queries only public, non-deleted events ordered by updated_at', async () => {
    await sitemap();
    expect(from).toHaveBeenCalledWith('events');
    expect(select).toHaveBeenCalledWith('id, slug, updated_at');
    expect(eq).toHaveBeenCalledWith('is_public', true);
    expect(is).toHaveBeenCalledWith('deleted_at', null);
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('serves the events fetch cached under the events-public tag with an hourly window', async () => {
    await sitemap();
    // Before the fix these were never called — the query ran uncached per request.
    expect(cacheTag).toHaveBeenCalledWith('events-public');
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('returns the static pages followed by the fetched event URLs', async () => {
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual([
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3000/events',
      'http://127.0.0.1:3000/pricing',
      'http://127.0.0.1:3000/events/s-1',
    ]);
  });
});
