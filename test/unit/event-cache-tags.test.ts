/**
 * T-100: the event-detail caches must be tagged ONLY with their per-event tag,
 * never the shared `events-public` listing tag.
 *
 * Tagging a detail page `events-public` meant any create/edit/delete of ANY
 * event nuked EVERY cached detail page at once — destroying hit rate with no
 * correctness gain, because every mutation that must refresh an event's detail
 * already busts the per-event tags via `revalidateEventDetailTags`.
 *
 * These tests pin (1) the detail cache tag set excludes `events-public`,
 * (2) mutating event X refreshes all of X's cached-detail variants (read/write
 * symmetry), and (3) mutating a different event Y touches none of X's detail
 * tags.
 */

import { describe, expect, it, vi } from 'vitest';

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag }));
// `event-cache-tags.ts` instantiates supabaseAdmin at module load; stub it so
// the unit test never needs a DB. Only revalidateEventListingTags uses it (not
// exercised here).
vi.mock('@/database/supabase-admin', () => ({ supabaseAdmin: {} }));

import { eventDetailCacheTags, revalidateEventDetailTags } from '@/lib/event-cache-tags';

describe('eventDetailCacheTags', () => {
  it('tags a detail page with only its per-event tag (never events-public)', () => {
    expect(eventDetailCacheTags('abc-123')).toEqual(['event-abc-123']);
  });

  it('never includes the shared events-public listing tag', () => {
    for (const param of ['uuid-x', 'seo-slug', 'SHARECODE']) {
      expect(eventDetailCacheTags(param)).not.toContain('events-public');
    }
  });
});

describe('revalidateEventDetailTags ↔ eventDetailCacheTags symmetry', () => {
  const event = { id: 'evt-1', slug: 'surf-cup', share_code: 'ABC123' };

  function bustedTags(identity: {
    id: string;
    slug: string | null;
    share_code: string | null;
  }): string[] {
    revalidateTag.mockClear();
    revalidateEventDetailTags(identity);
    return revalidateTag.mock.calls.map(([tag]) => tag as string);
  }

  it('mutating an event busts every param-variant its detail is cached under', () => {
    const busted = bustedTags(event);
    // Whatever param a viewer reached event-1 by (UUID, slug, or share code),
    // that cached detail entry is invalidated.
    for (const param of [event.id, event.slug, event.share_code]) {
      for (const tag of eventDetailCacheTags(param)) {
        expect(busted).toContain(tag);
      }
    }
  });

  it('mutating a DIFFERENT event touches none of event-1 detail tags (no over-invalidation)', () => {
    const busted = bustedTags({ id: 'evt-2', slug: 'trail-run', share_code: 'ZZZ999' });
    const eventOneTags = [event.id, event.slug, event.share_code].flatMap(eventDetailCacheTags);
    for (const tag of eventOneTags) {
      expect(busted).not.toContain(tag);
    }
  });

  it('does not bust the shared events-public tag from a detail mutation', () => {
    expect(bustedTags(event)).not.toContain('events-public');
  });
});
