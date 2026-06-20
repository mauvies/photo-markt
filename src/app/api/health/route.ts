import { NextResponse } from 'next/server';

/**
 * Liveness probe for external uptime monitors (status page, ping cron).
 *
 * Deliberately minimal: no auth, no DB, no env reads — it answers "is the app
 * process up and serving requests?" and nothing more. Dependency health
 * (Supabase, Stripe, etc.) is intentionally out of scope; add it as a separate
 * readiness endpoint if needed later.
 *
 * `force-dynamic` keeps Next from statically prerendering this at build time so
 * the probe reflects a live request. `/api/*` is already disallowed in
 * robots.ts, so it won't be indexed.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
