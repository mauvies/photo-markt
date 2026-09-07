import { describe, expect, it } from 'vitest';
import {
  cleanupRateLimitBuckets,
  RATE_LIMIT_BUCKET_RETENTION_SEC,
} from '@/lib/inngest/functions/cleanup-rate-limit-buckets';
import { computeWindow, MAX_RATE_LIMIT_WINDOW_SEC, rateLimit } from '@/lib/rate-limit';

/**
 * T-218: the purge cron and the limiters share one contract — no limiter may
 * use a window the purge would delete mid-flight. Pinned from both sides:
 * the retention is derived from the ceiling, and the ceiling is enforced at
 * the call, so neither can drift on its own.
 */
describe('rate-limit window ceiling (T-218)', () => {
  it('keeps buckets for exactly twice the longest permitted window', () => {
    expect(RATE_LIMIT_BUCKET_RETENTION_SEC).toBe(2 * MAX_RATE_LIMIT_WINDOW_SEC);
  });

  it('admits every window up to the ceiling', () => {
    expect(() => computeWindow(Date.now(), 3600)).not.toThrow();
    expect(() => computeWindow(Date.now(), MAX_RATE_LIMIT_WINDOW_SEC)).not.toThrow();
  });

  it('refuses a window wider than the ceiling, loudly — not via the fail-open', async () => {
    const wider = MAX_RATE_LIMIT_WINDOW_SEC + 1;
    expect(() => computeWindow(Date.now(), wider)).toThrow(/MAX_RATE_LIMIT_WINDOW_SEC/);
    // `rateLimit` must surface it too: a caller must not get an `ok: true` for a
    // limiter whose counter the purge is going to erase.
    const backend = async () => 1;
    await expect(rateLimit({ key: 'x', limit: 1, windowSec: wider }, backend)).rejects.toThrow(
      /MAX_RATE_LIMIT_WINDOW_SEC/,
    );
  });

  it('runs hourly in its own cron slot (:20), off the four existing ones', () => {
    // Inngest exposes the config it was created with; `triggers` is what the
    // dashboard syncs. The minute must not collide with 0,30 · 10,40 · 15,45 · 25,55.
    const config = (
      cleanupRateLimitBuckets as unknown as { opts: { triggers?: { cron?: string }[] } }
    ).opts;
    const cron = config.triggers?.find((t) => t.cron)?.cron;
    expect(cron).toBe('20 * * * *');
  });
});
