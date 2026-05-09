export type RateLimitResult = {
  /** True if the request is within the limit (caller may proceed). */
  ok: boolean;
  /** Requests remaining in the current window after this one (>= 0). */
  remaining: number;
  /** When the current fixed window ends and the count resets. */
  resetAt: Date;
};

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

/** Pure: compute the fixed window aligned to epoch for a given (now, size). */
export function computeWindow(nowMs: number, windowSec: number): { start: Date; resetAt: Date } {
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
 * Check and consume one request from the given bucket.
 *
 * Fails open (returns ok=true) if the backend errors — we'd rather serve a
 * request than 500 the whole app because rate-limit storage hiccuped.
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
    console.error('rateLimit backend error; failing open', { key: config.key, err });
    return { ok: true, remaining: config.limit, resetAt };
  }
  return evaluate(count, config.limit, resetAt);
}

/**
 * Best-effort client IP from request headers. Vercel populates
 * x-forwarded-for; the first hop is the original client. Falls back to
 * x-real-ip, then a constant so missing headers still produce a usable key
 * (one bad-actor "unknown" bucket beats throwing).
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/**
 * Number of seconds the caller should wait before retrying. Used as the
 * `Retry-After` header value on 429s.
 */
export function retryAfterSeconds(result: RateLimitResult, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil((result.resetAt.getTime() - nowMs) / 1000));
}
