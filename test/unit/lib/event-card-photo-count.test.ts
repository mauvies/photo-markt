import { describe, expect, it } from 'vitest';
import { getEventCardPhotoCount } from '@/lib/event-cover-stats';

/**
 * T-229. The temporary total-count override was wired into the event detail page
 * only, so the same event showed one number inside and a different one on its
 * card in the home, `/events`, saved events and the public photographer profile.
 *
 * ⚠️ These ids are the real ones in `event-photo-count-overrides.ts`. When that
 * file is deleted this test goes with it — see the removal list in its header.
 */
const OVERRIDDEN_EVENT = 'c7d3b768-f567-4efc-9aaf-ae4e54ea52bc';
const OVERRIDDEN_TOTAL = 7342;

describe('getEventCardPhotoCount', () => {
  it('shows the override for a listed event, not its real photo count', () => {
    const stats = new Map([[OVERRIDDEN_EVENT, { count: 3 }]]);
    expect(getEventCardPhotoCount(OVERRIDDEN_EVENT, stats)).toBe(OVERRIDDEN_TOTAL);
  });

  it('applies the override even when the event has no photo rows at all', () => {
    // The whole reason this takes the map instead of a count: an event with no
    // photos never appears in `stats`, and those are exactly the events the
    // override exists for.
    expect(getEventCardPhotoCount(OVERRIDDEN_EVENT, new Map())).toBe(OVERRIDDEN_TOTAL);
  });

  it('leaves an unlisted event on its real count', () => {
    const stats = new Map([['not-overridden', { count: 12 }]]);
    expect(getEventCardPhotoCount('not-overridden', stats)).toBe(12);
    expect(getEventCardPhotoCount('missing-entirely', stats)).toBe(0);
  });
});
