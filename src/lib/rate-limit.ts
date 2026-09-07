export type RateLimitResult = {
  /** True if the request is within the limit (caller may proceed). */
  ok: boolean;
  /** Requests remaining in the current window after this one (>= 0). */
  remaining: number;
  /** When the current fixed window ends and the count resets. */
  resetAt: Date;
};

/**
 * The longest fixed window any limiter in the app may use (24 h — the
 * face-search daily cost tiers and the once-a-day money-alert claims).
 *
 * This is not documentation, it is the contract the purge cron relies on
 * (T-218): `cleanup-rate-limit-buckets` deletes every bucket whose window
 * started more than `2 × MAX_RATE_LIMIT_WINDOW_SEC` ago. A limiter with a
 * longer window would have its live counter deleted mid-window — the count
 * restarts at 1 and the limit is silently bypassed. So `rateLimit` and
 * `rateLimitCost` refuse a wider window up front, loudly, instead of letting
 * the purge fail it open later. Raising this constant raises the retention
 * with it; nothing else needs to move.
 */
export const MAX_RATE_LIMIT_WINDOW_SEC = 24 * 60 * 60;

export type RateLimitConfig = {
  /**
   * Identity-scoped key. Compose action and identity, e.g.
   *   `upload:guest:${eventId}:${ip}` or `checkout:${userId}`.
   * Different actions for the same user MUST get different keys so they
   * don't share a budget.
   */
  key: string;
  /** Maximum requests permitted within the window. */
  limit: number;
  /** Window length in seconds (fixed window — aligned to epoch). */
  windowSec: number;
};

/**
 * Backend abstraction. Receives the bucket key and computed window start;
 * returns the new count (post-increment). Throw on failure — `rateLimit()`
 * fails open on errors.
 */
export type RateLimitBackend = (key: string, windowStart: Date) => Promise<number>;

/**
 * Cost-aware backend: increments the bucket by `amount` (not a flat 1) and
 * returns the new count. Used by the face-search cost tiers, which count real
 * AWS calls per operation. Throw on failure — `rateLimitCost()` fails open.
 */
export type RateLimitCostBackend = (
  key: string,
  windowStart: Date,
  amount: number,
) => Promise<number>;

/**
 * Pure: compute the fixed window aligned to epoch for a given (now, size).
 *
 * Throws on a window wider than `MAX_RATE_LIMIT_WINDOW_SEC` — a programming
 * error, not a runtime condition, so it is deliberately NOT covered by the
 * fail-open in `rateLimit`: every call site runs in the integration suite and
 * a misconfigured limiter must fail the build, not quietly lose its counter to
 * the purge cron in production (T-218).
 */
export function computeWindow(nowMs: number, windowSec: number): { start: Date; resetAt: Date } {
  if (windowSec > MAX_RATE_LIMIT_WINDOW_SEC) {
    throw new Error(
      `rate-limit window of ${windowSec}s exceeds MAX_RATE_LIMIT_WINDOW_SEC (${MAX_RATE_LIMIT_WINDOW_SEC}s); ` +
        'the purge cron would delete its bucket mid-window — raise the constant or shorten the window',
    );
  }
  const sizeMs = windowSec * 1000;
  const startMs = Math.floor(nowMs / sizeMs) * sizeMs;
  return { start: new Date(startMs), resetAt: new Date(startMs + sizeMs) };
}

/** Pure: derive the result from a count + limit. */
export function evaluate(count: number, limit: number, resetAt: Date): RateLimitResult {
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/**
 * Postgres-backed atomic increment. Uses the `increment_rate_limit_bucket`
 * RPC to upsert + increment in one round-trip, avoiding races between concurrent
 * requests for the same key.
 *
 * The supabase-admin import is lazy so this module stays importable in
 * environments without server env vars (e.g., unit tests for the pure logic).
 */
export const pgBackend: RateLimitBackend = async (key, windowStart) => {
  const { supabaseAdmin } = await import('@/database/supabase-admin');
  const { data, error } = await supabaseAdmin.rpc('increment_rate_limit_bucket', {
    p_bucket_key: key,
    p_window_start: windowStart.toISOString(),
  });
  if (error) throw error;
  if (typeof data !== 'number') {
    throw new Error('increment_rate_limit_bucket returned non-number');
  }
  return data;
};

/**
 * Postgres-backed atomic increment-by-N. Uses the
 * `increment_rate_limit_bucket_by` RPC (single-statement upsert with
 * `RETURNING`) so a concurrent burst can't undercount. Sibling of `pgBackend`
 * for the cost tiers that must increment by the AWS-call count, not a flat 1.
 */
export const pgCostBackend: RateLimitCostBackend = async (key, windowStart, amount) => {
  const { supabaseAdmin } = await import('@/database/supabase-admin');
  const { data, error } = await supabaseAdmin.rpc('increment_rate_limit_bucket_by', {
    p_bucket_key: key,
    p_window_start: windowStart.toISOString(),
    p_amount: amount,
  });
  if (error) throw error;
  if (typeof data !== 'number') {
    throw new Error('increment_rate_limit_bucket_by returned non-number');
  }
  return data;
};

/**
 * Fail-open is invisible by design: a sustained backend outage silently disables
 * every limiter (including face search, which gates AWS spend) with only a
 * `console.error`. Surface it to Sentry so the degradation is observable — but
 * throttle so an outage doesn't emit one event per request. One event per
 * process per window makes it visible; a stable fingerprint keeps them grouped
 * as a single Sentry issue. The throttle is per-process (serverless), which
 * still bounds volume meaningfully during an outage (F-20, caching audit T-083).
 */
const FAIL_ALERT_THROTTLE_MS = 60_000;
let lastFailAlertMs = 0;

/**
 * Report a limiter backend error to Sentry (throttled). `failMode` records
 * whether the caller then served the request (`open`) or refused it (`closed`)
 * — throttles are fail-open (availability), the cost breaker is fail-closed
 * (never let a DB hiccup silently disable the AWS-spend ceiling).
 */
async function reportBackendError(
  config: RateLimitConfig,
  err: unknown,
  nowMs: number,
  failMode: 'open' | 'closed',
): Promise<void> {
  // Always log; the Sentry alert is the throttled, higher-signal channel.
  console.error(`rateLimit backend error; failing ${failMode}`, { key: config.key, err });

  if (nowMs - lastFailAlertMs < FAIL_ALERT_THROTTLE_MS) return;
  lastFailAlertMs = nowMs;

  // Lazy import (like pgBackend) so the module stays importable without the
  // Sentry SDK, and no-op when no DSN is configured. Only the limiter's action
  // prefix is sent — the identity suffix (IP / user id) is deliberately dropped
  // to honour the app's `sendDefaultPii: false` invariant (src/lib/observability/sentry.ts).
  const limiter = config.key.split(':')[0];
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err, {
      level: 'warning',
      fingerprint: ['rate-limit-backend-error'],
      tags: { subsystem: 'rate-limit', outcome: `fail-${failMode}`, limiter },
      extra: { limiter, limit: config.limit },
    });
  } catch (sentryErr) {
    // Observability must never break the request path.
    console.error('failed to report rateLimit backend error to Sentry', sentryErr);
  }
}

/**
 * Check and consume one request from the given bucket.
 *
 * Fails open (returns ok=true) if the backend errors — we'd rather serve a
 * request than 500 the whole app because rate-limit storage hiccuped. The
 * fail-open is reported to Sentry (throttled) so it isn't silent.
 */
export async function rateLimit(
  config: RateLimitConfig,
  backend: RateLimitBackend = pgBackend,
): Promise<RateLimitResult> {
  const { start, resetAt } = computeWindow(Date.now(), config.windowSec);
  let count: number;
  try {
    count = await backend(config.key, start);
  } catch (err) {
    await reportBackendError(config, err, Date.now(), 'open');
    return { ok: true, remaining: config.limit, resetAt };
  }
  return evaluate(count, config.limit, resetAt);
}

/**
 * Cost-aware variant of `rateLimit`: atomically increments the bucket by
 * `config.cost` (the number of billable AWS calls the operation performs) and
 * decides on the returned count. Increment-before-work + single-statement RPC
 * defeats the concurrent-burst race (N requests can't all sail past a
 * not-yet-incremented counter).
 *
 * Deliberately NOT unified with `rateLimit`: this is a **cost circuit breaker**,
 * not an availability throttle, so it **fails closed**. A throttle would rather
 * serve a request than 500 the app when the counter storage hiccups; a spend
 * breaker must do the opposite — if we can't confirm we're under the AWS-call
 * ceiling, refuse rather than let a DB error silently uncap the bill (the exact
 * unbounded-spend hole this ticket closes). Face search degrades to
 * "temporarily unavailable" during a counter outage; bib search + the rest of
 * the app are untouched.
 */
export async function rateLimitCost(
  config: RateLimitConfig & { cost: number },
  backend: RateLimitCostBackend = pgCostBackend,
): Promise<RateLimitResult> {
  const { start, resetAt } = computeWindow(Date.now(), config.windowSec);
  let count: number;
  try {
    count = await backend(config.key, start, config.cost);
  } catch (err) {
    await reportBackendError(config, err, Date.now(), 'closed');
    return { ok: false, remaining: 0, resetAt };
  }
  return evaluate(count, config.limit, resetAt);
}

/**
 * Best-effort client IP from request headers, for keying per-IP rate limits.
 *
 * On this app's deployment target (stock Vercel, no Enterprise "Trusted
 * Proxy" add-on), Vercel's edge overwrites x-forwarded-for entirely with the
 * single IP it observed and does not forward client-supplied values — see
 * https://vercel.com/docs/headers/request-headers#x-forwarded-for. x-real-ip
 * is documented as identical to x-forwarded-for. So on THIS platform,
 * neither header is a multi-hop, client-appendable chain in practice.
 *
 * Still: prioritize x-real-ip, and if only x-forwarded-for is present, take
 * the RIGHTMOST hop rather than the leftmost. This is defense-in-depth for
 * any environment where x-forwarded-for genuinely can be a chain a client
 * partially controls (a proxy layered in front of Vercel, local dev, a
 * future hosting change) — the leftmost hop is always the least trustworthy
 * position in that shape, so never treat it as authoritative. Falls back to
 * a constant so missing headers still produce a usable key (one bad-actor
 * "unknown" bucket beats throwing).
 */
export function getClientIp(headers: Headers): string {
  const real = headers.get('x-real-ip');
  if (real?.trim()) return real.trim();
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return 'unknown';
}

/**
 * Number of seconds the caller should wait before retrying. Used as the
 * `Retry-After` header value on 429s.
 */
export function retryAfterSeconds(result: RateLimitResult, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil((result.resetAt.getTime() - nowMs) / 1000));
}
