import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/env.mjs';
import { getCachedReadinessReport } from '@/lib/health/probes';
import { getClientIp, rateLimit, retryAfterSeconds } from '@/lib/rate-limit';

/**
 * Readiness probe (T-044). Unlike `/api/health` (liveness), this runs cheap
 * read-only probes against each external service to confirm it's reachable and
 * our credentials are valid: `{ status, environment, checks: [...] }`.
 *
 * Guarded by `HEALTH_CHECK_TOKEN` (locked with 401 until configured) and
 * rate-limited (it calls paid APIs). Probe error detail is never returned — see
 * `lib/health/probes.ts`. `no-store` everywhere so monitors see live state.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function extractToken(request: Request): string | null {
  const queryToken = new URL(request.url).searchParams.get('token');
  if (queryToken) return queryToken;
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return request.headers.get('x-health-token');
}

/** Constant-time compare. The token check runs before rate-limiting, so a
 * naive `!==` would be timing-attackable. SHA-256 both sides first so the
 * compare is over fixed-length digests — no early return that would leak the
 * token's length. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = env.HEALTH_CHECK_TOKEN;
  const provided = extractToken(request);
  if (!expected || !provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const ip = getClientIp(request.headers);
  const rl = await rateLimit({ key: `health-ready:${ip}`, limit: 20, windowSec: 3600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfterSeconds(rl)) } },
    );
  }

  // Cached (≤15s) so repeated monitor hits or a fail-open limiter can't hammer
  // the paid probes. 200 even when degraded/down so the monitor can read the
  // body; alerting keys off the `status` field, not the HTTP code.
  const report = await getCachedReadinessReport();
  return NextResponse.json(report, { status: 200, headers: NO_STORE });
}
