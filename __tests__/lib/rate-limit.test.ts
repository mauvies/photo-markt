import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeWindow,
  evaluate,
  getClientIp,
  type RateLimitBackend,
  rateLimit,
  retryAfterSeconds,
} from '../../lib/rate-limit';

test('computeWindow aligns to multiples of windowSec from epoch', () => {
  const nowMs = Date.parse('2026-05-09T12:34:56.789Z');
  const { start, resetAt } = computeWindow(nowMs, 60);
  // 60-second window containing 12:34:56 starts at 12:34:00.
  assert.equal(start.toISOString(), '2026-05-09T12:34:00.000Z');
  assert.equal(resetAt.toISOString(), '2026-05-09T12:35:00.000Z');
});

test('computeWindow handles hour-sized windows', () => {
  const nowMs = Date.parse('2026-05-09T12:34:56.789Z');
  const { start, resetAt } = computeWindow(nowMs, 3600);
  assert.equal(start.toISOString(), '2026-05-09T12:00:00.000Z');
  assert.equal(resetAt.toISOString(), '2026-05-09T13:00:00.000Z');
});

test('evaluate: count under limit → ok with positive remaining', () => {
  const reset = new Date('2026-05-09T13:00:00Z');
  const r = evaluate(3, 10, reset);
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 7);
  assert.equal(r.resetAt, reset);
});

test('evaluate: count at limit → ok with zero remaining (allowed boundary)', () => {
  const r = evaluate(10, 10, new Date());
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 0);
});

test('evaluate: count over limit → blocked', () => {
  const r = evaluate(11, 10, new Date());
  assert.equal(r.ok, false);
  assert.equal(r.remaining, 0);
});

test('rateLimit: in-memory backend tracks counts per (key, window)', async () => {
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
  assert.deepEqual(
    [r1.ok, r2.ok, r3.ok, r4.ok],
    [true, true, true, false],
    'first 3 pass, 4th blocked',
  );
  assert.equal(r1.remaining, 2);
  assert.equal(r4.remaining, 0);
});

test('rateLimit: separate keys do not share budget', async () => {
  const counts = new Map<string, number>();
  const backend: RateLimitBackend = async (key, windowStart) => {
    const ck = `${key}|${windowStart.toISOString()}`;
    const next = (counts.get(ck) ?? 0) + 1;
    counts.set(ck, next);
    return next;
  };

  const a = await rateLimit({ key: 'upload:user:A', limit: 1, windowSec: 60 }, backend);
  const b = await rateLimit({ key: 'upload:user:B', limit: 1, windowSec: 60 }, backend);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'user B should not be affected by user A hitting the limit');
});

test('rateLimit: backend error fails open', async () => {
  const failing: RateLimitBackend = async () => {
    throw new Error('postgres exploded');
  };
  // Suppress noisy console.error from the fail-open path during this test.
  const originalError = console.error;
  console.error = () => {};
  try {
    const r = await rateLimit({ key: 'k', limit: 1, windowSec: 60 }, failing);
    assert.equal(r.ok, true, 'fail open: never break the request because the limiter is down');
    assert.equal(r.remaining, 1);
  } finally {
    console.error = originalError;
  }
});

test('getClientIp: prefers first IP in x-forwarded-for', () => {
  const h = new Headers();
  h.set('x-forwarded-for', '203.0.113.5, 70.41.3.18, 150.172.238.178');
  assert.equal(getClientIp(h), '203.0.113.5');
});

test('getClientIp: falls back to x-real-ip when forwarded missing', () => {
  const h = new Headers();
  h.set('x-real-ip', '198.51.100.7');
  assert.equal(getClientIp(h), '198.51.100.7');
});

test('getClientIp: returns "unknown" when no headers present', () => {
  assert.equal(getClientIp(new Headers()), 'unknown');
});

test('retryAfterSeconds: rounds up and is at least 1', () => {
  const result = { ok: false, remaining: 0, resetAt: new Date(Date.now() + 12_500) };
  // 12.5 seconds → ceil to 13.
  assert.equal(retryAfterSeconds(result), 13);
});

test('retryAfterSeconds: never returns 0 even if resetAt is in the past', () => {
  const result = { ok: false, remaining: 0, resetAt: new Date(Date.now() - 5_000) };
  assert.equal(retryAfterSeconds(result), 1);
});
