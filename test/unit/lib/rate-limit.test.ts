import { describe, expect, it, vi } from 'vitest';
import {
  computeWindow,
  evaluate,
  getClientIp,
  type RateLimitBackend,
  type RateLimitCostBackend,
  rateLimit,
  rateLimitCost,
  retryAfterSeconds,
} from '@/lib/rate-limit';

describe('computeWindow', () => {
  it('aligns to multiples of windowSec from epoch', () => {
    const nowMs = Date.parse('2026-05-09T12:34:56.789Z');
    const { start, resetAt } = computeWindow(nowMs, 60);
    // 60-second window containing 12:34:56 starts at 12:34:00.
    expect(start.toISOString()).toBe('2026-05-09T12:34:00.000Z');
    expect(resetAt.toISOString()).toBe('2026-05-09T12:35:00.000Z');
  });

  it('handles hour-sized windows', () => {
    const nowMs = Date.parse('2026-05-09T12:34:56.789Z');
    const { start, resetAt } = computeWindow(nowMs, 3600);
    expect(start.toISOString()).toBe('2026-05-09T12:00:00.000Z');
    expect(resetAt.toISOString()).toBe('2026-05-09T13:00:00.000Z');
  });
});

describe('evaluate', () => {
  it('count under limit → ok with positive remaining', () => {
    const reset = new Date('2026-05-09T13:00:00Z');
    const r = evaluate(3, 10, reset);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(7);
    expect(r.resetAt).toBe(reset);
  });

  it('count at limit → ok with zero remaining (allowed boundary)', () => {
    const r = evaluate(10, 10, new Date());
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('count over limit → blocked', () => {
    const r = evaluate(11, 10, new Date());
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });
});

describe('rateLimit', () => {
  it('in-memory backend tracks counts per (key, window)', async () => {
    // Simulates a real backend: counts per-key, never resets within this test.
    const counts = new Map<string, number>();
    const backend: RateLimitBackend = async (key, windowStart) => {
      const compoundKey = `${key}|${windowStart.toISOString()}`;
      const next = (counts.get(compoundKey) ?? 0) + 1;
      counts.set(compoundKey, next);
      return next;
    };

    const cfg = { key: 'upload:user:abc', limit: 3, windowSec: 60 };
    // First three requests pass; fourth blocks.
    const r1 = await rateLimit(cfg, backend);
    const r2 = await rateLimit(cfg, backend);
    const r3 = await rateLimit(cfg, backend);
    const r4 = await rateLimit(cfg, backend);
    expect([r1.ok, r2.ok, r3.ok, r4.ok]).toEqual([true, true, true, false]);
    expect(r1.remaining).toBe(2);
    expect(r4.remaining).toBe(0);
  });

  it('separate keys do not share budget', async () => {
    const counts = new Map<string, number>();
    const backend: RateLimitBackend = async (key, windowStart) => {
      const ck = `${key}|${windowStart.toISOString()}`;
      const next = (counts.get(ck) ?? 0) + 1;
      counts.set(ck, next);
      return next;
    };

    const a = await rateLimit({ key: 'upload:user:A', limit: 1, windowSec: 60 }, backend);
    const b = await rateLimit({ key: 'upload:user:B', limit: 1, windowSec: 60 }, backend);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('backend error fails open', async () => {
    const failing: RateLimitBackend = async () => {
      throw new Error('postgres exploded');
    };
    // Silence the fail-open log via Vitest's spy — restores automatically.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await rateLimit({ key: 'k', limit: 1, windowSec: 60 }, failing);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('rateLimitCost', () => {
  // Simulates the atomic increment-by-N RPC: one shared counter per (key,
  // window), bumped by `amount` and returning the post-increment value.
  function makeCostBackend(): { backend: RateLimitCostBackend; counts: Map<string, number> } {
    const counts = new Map<string, number>();
    const backend: RateLimitCostBackend = async (key, windowStart, amount) => {
      const ck = `${key}|${windowStart.toISOString()}`;
      const next = (counts.get(ck) ?? 0) + amount;
      counts.set(ck, next);
      return next;
    };
    return { backend, counts };
  }

  it('increments by cost, not a flat 1', async () => {
    const { backend, counts } = makeCostBackend();
    const cfg = { key: 'face-search-global-day', limit: 10, windowSec: 86_400, cost: 2 };
    const r1 = await rateLimitCost(cfg, backend);
    expect(r1.ok).toBe(true);
    // One call bumped the bucket by the cost (2), not 1.
    expect([...counts.values()][0]).toBe(2);
    expect(r1.remaining).toBe(8);
  });

  it('blocks once the incremented count exceeds the limit', async () => {
    const { backend } = makeCostBackend();
    const cfg = { key: 'k', limit: 3, windowSec: 60, cost: 1 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimitCost(cfg, backend));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it('a cost step that jumps past the limit blocks that request', async () => {
    const { backend } = makeCostBackend();
    const cfg = { key: 'k', limit: 5, windowSec: 60, cost: 3 };
    const r1 = await rateLimitCost(cfg, backend); // count 3 <= 5 → ok
    const r2 = await rateLimitCost(cfg, backend); // count 6 > 5 → blocked
    expect([r1.ok, r2.ok]).toEqual([true, false]);
  });

  it('concurrent burst against an atomic backend does not undercount', async () => {
    const { backend } = makeCostBackend();
    const cap = 5;
    const cfg = { key: 'burst', limit: cap, windowSec: 86_400, cost: 1 };
    // Fire 20 at once; an atomic increment gives each a distinct monotonic
    // count, so exactly `cap` observe a count within the limit.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimitCost(cfg, backend)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(cap);
  });

  it('fails CLOSED when the backend errors (cost breaker must not uncap spend)', async () => {
    const failing: RateLimitCostBackend = async () => {
      throw new Error('postgres exploded');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await rateLimitCost({ key: 'k', limit: 1, windowSec: 60, cost: 1 }, failing);
      // Unlike the throttle, a spend breaker refuses when it can't verify the cap.
      expect(r.ok).toBe(false);
      expect(r.remaining).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('getClientIp', () => {
  it('returns the single IP in x-forwarded-for when there is no proxy chain', () => {
    const h = new Headers();
    h.set('x-forwarded-for', '203.0.113.5');
    expect(getClientIp(h)).toBe('203.0.113.5');
  });

  it('falls back to the rightmost hop of x-forwarded-for rather than the leftmost (T-086)', () => {
    // On this app's stock-Vercel deployment, Vercel overwrites
    // x-forwarded-for with a single edge-observed IP and never forwards a
    // client-supplied chain (vercel.com/docs/headers/request-headers), so
    // this multi-hop shape shouldn't occur in this app's production traffic.
    // It's still the right default for any environment where the header
    // legitimately is a chain a client partially controls — the leftmost
    // hop is always the least trustworthy position in that shape.
    const h = new Headers();
    h.set('x-forwarded-for', '1.2.3.4, 70.41.3.18, 203.0.113.9');
    expect(getClientIp(h)).toBe('203.0.113.9');
  });

  it('prioritizes x-real-ip over x-forwarded-for when both are present (T-086)', () => {
    const h = new Headers();
    h.set('x-forwarded-for', '1.2.3.4, 203.0.113.9');
    h.set('x-real-ip', '198.51.100.7');
    expect(getClientIp(h)).toBe('198.51.100.7');
  });

  it('falls back to x-real-ip when forwarded missing', () => {
    const h = new Headers();
    h.set('x-real-ip', '198.51.100.7');
    expect(getClientIp(h)).toBe('198.51.100.7');
  });

  it('returns "unknown" when no headers present', () => {
    expect(getClientIp(new Headers())).toBe('unknown');
  });
});

describe('retryAfterSeconds', () => {
  it('rounds up and is at least 1', () => {
    const result = { ok: false, remaining: 0, resetAt: new Date(Date.now() + 12_500) };
    // 12.5 seconds → ceil to 13.
    expect(retryAfterSeconds(result)).toBe(13);
  });

  it('never returns 0 even if resetAt is in the past', () => {
    const result = { ok: false, remaining: 0, resetAt: new Date(Date.now() - 5_000) };
    expect(retryAfterSeconds(result)).toBe(1);
  });
});
