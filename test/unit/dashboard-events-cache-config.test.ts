/**
 * Pins the cache invariant for the photographer dashboard events listing
 * (F-06, caching audit T-083).
 *
 * `getCachedEventsData` embeds signed Supabase cover URLs (TTL `SIGNED_URL_TTL`)
 * inside a `'use cache'` entry. If that entry can be served past the signed-URL
 * window, covers break. `cacheLife` originally set only `revalidate` (no
 * `expire`), so stale-while-revalidate could serve an entry beyond the 55-min
 * URL expiry. A hard `expire` ≤ `SIGNED_URL_TTL` closes the gap.
 */

import { describe, expect, it } from 'vitest';
import {
  EVENTS_CACHE_LIFE,
  SIGNED_URL_TTL,
} from '@/app/[lang]/dashboard/photographer/events/cache-config';

describe('dashboard events cache config', () => {
  it('sets a hard `expire` cutoff (not just `revalidate`)', () => {
    // Before the fix `expire` was absent, so the entry could be served
    // stale-while-revalidate past its embedded signed URLs.
    expect(EVENTS_CACHE_LIFE.expire).toBeTypeOf('number');
  });

  it('never lets a cached entry outlive its embedded signed cover URLs', () => {
    expect(EVENTS_CACHE_LIFE.expire).toBeLessThanOrEqual(SIGNED_URL_TTL);
  });

  it('uses `expire === revalidate` as a hard cutoff, matching the public caches', () => {
    expect(EVENTS_CACHE_LIFE.expire).toBe(EVENTS_CACHE_LIFE.revalidate);
  });
});
