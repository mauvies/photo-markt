/**
 * Regression tests for T-098: the rate limiter fails open (by design) when its
 * backend errors, but that was silent (only `console.error`). It must now also
 * surface the degradation to Sentry — throttled so a sustained outage doesn't
 * emit one event per request, and without leaking the identity (IP / user id)
 * baked into the bucket key.
 *
 * Each test re-imports the module (`vi.resetModules`) so the per-process throttle
 * timestamp starts fresh and test ordering can't leak state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitBackend } from '@/lib/rate-limit';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException, captureMessage: vi.fn() }));

async function loadRateLimit() {
  vi.resetModules();
  return (await import('@/lib/rate-limit')).rateLimit;
}

const failing: RateLimitBackend = async () => {
  throw new Error('postgres exploded');
};

const cfg = { key: 'face-search:SHARE123:203.0.113.5', limit: 10, windowSec: 3600 };

describe('rateLimit fail-open Sentry alerting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the fail-open semantics (ok, remaining=limit)', async () => {
    const rateLimit = await loadRateLimit();
    const r = await rateLimit(cfg, failing);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(cfg.limit);
  });

  it('captures the backend error to Sentry on fail-open', async () => {
    const rateLimit = await loadRateLimit();
    await rateLimit(cfg, failing);
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, context] = captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(context.level).toBe('warning');
    expect(context.fingerprint).toEqual(['rate-limit-fail-open']);
  });

  it('sends only the limiter action prefix — never the IP / user-id in the key', async () => {
    const rateLimit = await loadRateLimit();
    await rateLimit(cfg, failing);
    const context = captureException.mock.calls[0][1];
    expect(context.extra.limiter).toBe('face-search');
    // The identity suffix (share code, IP) must not reach Sentry.
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('203.0.113.5');
    expect(serialized).not.toContain('SHARE123');
  });

  it('throttles: a burst of fail-opens within the window emits a single event', async () => {
    const rateLimit = await loadRateLimit();
    await rateLimit(cfg, failing);
    vi.advanceTimersByTime(1_000);
    await rateLimit(cfg, failing);
    vi.advanceTimersByTime(58_000);
    await rateLimit(cfg, failing);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('emits again once the throttle window has passed', async () => {
    const rateLimit = await loadRateLimit();
    await rateLimit(cfg, failing);
    vi.advanceTimersByTime(60_001);
    await rateLimit(cfg, failing);
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('does not touch Sentry when the backend succeeds', async () => {
    const rateLimit = await loadRateLimit();
    const ok: RateLimitBackend = async () => 1;
    await rateLimit(cfg, ok);
    expect(captureException).not.toHaveBeenCalled();
  });
});
