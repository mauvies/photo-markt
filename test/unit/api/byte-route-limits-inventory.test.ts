import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-221: every route handler under `src/app/api/` must have DECLARED whether it
 * carries the two abuse protections — a `maxDuration` ceiling and a per-IP rate
 * limit — and the byte-serving ones must actually carry both.
 *
 * The bug this replaces was pure drift, not a missing idea: `/api/watermark`
 * grew both in T-094 and its sibling `/api/thumb` grew neither, though both
 * stream from the same private bucket with the same service-role client. The
 * fix for one route is not the protection — this inventory is: a NEW route file
 * fails the suite until someone writes down which posture it has and why, so
 * the next byte route cannot be born unbounded the same quiet way.
 *
 * Source-level on purpose (same reasoning as the dead-route tests): `maxDuration`
 * is a Next route-segment export read at build time, so there is nothing to
 * observe by importing the module or by calling the handler in a unit run.
 */

const API_DIR = join(process.cwd(), 'src/app/api');

/**
 * `bytes` — serves stored objects from Supabase Storage on a cache miss, so an
 * uncapped request bills open-ended serverless time and unbounded egress.
 * These MUST declare `maxDuration` and a rate limit keyed on the client IP.
 *
 * `exempt` — everything else, each with the reason it needs neither, so the
 * exemption is a decision on the record rather than an omission.
 */
const ROUTE_POSTURE: Record<string, { posture: 'bytes' | 'exempt'; reason: string }> = {
  'thumb/[...path]/route.ts': {
    posture: 'bytes',
    reason: 'baked thumbnails from the private photos bucket; every grid tile is a request',
  },
  'watermark/[...path]/route.ts': {
    posture: 'bytes',
    reason: 'protected previews: storage download + a Sharp encode per miss',
  },
  'download/[token]/route.ts': {
    posture: 'bytes',
    reason: 'guest purchase ZIP, unauthenticated and addressed by a bearer token',
  },
  'events/[id]/download/route.ts': {
    posture: 'bytes',
    reason: 'purchased-photo ZIP: streams every bought original in one request',
  },
  'health/route.ts': {
    posture: 'exempt',
    reason: 'liveness probe — no auth, no DB, no env reads; there is nothing to amplify',
  },
  'health/ready/route.ts': {
    posture: 'exempt',
    reason:
      'token-gated readiness probe; already rate-limited per IP, and its dependency pings are ' +
      'bounded by their own clients rather than a route ceiling',
  },
  'inngest/route.ts': {
    posture: 'exempt',
    reason:
      'signature-verified worker; per-function timeouts and concurrency live on the Inngest ' +
      'functions themselves, and throttling the worker would stall background jobs',
  },
  'stripe/webhook/route.ts': {
    posture: 'exempt',
    reason:
      'signature-verified third-party caller. Declares maxDuration=60 but deliberately NO rate ' +
      'limit: a throttled delivery is a dropped money event (T-252/T-262 depend on redelivery)',
  },
};

/** Every `route.ts` under `src/app/api/`, as a path relative to that directory. */
function apiRouteFiles(): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/^route\.(ts|tsx|js|jsx)$/.test(entry)) {
        found.push(relative(API_DIR, full).split(sep).join('/'));
      }
    }
  };
  walk(API_DIR);
  return found.sort();
}

function sourceOf(relativePath: string): string {
  return readFileSync(join(API_DIR, relativePath), 'utf8');
}

const byteRoutes = Object.entries(ROUTE_POSTURE)
  .filter(([, v]) => v.posture === 'bytes')
  .map(([file]) => file);

describe('API byte-route limits inventory (T-221)', () => {
  it('declares a posture for every route handler under src/app/api/', () => {
    expect(
      apiRouteFiles(),
      'a new API route must be declared in ROUTE_POSTURE as `bytes` (needs maxDuration + a ' +
        'per-IP rate limit) or `exempt` with the reason it needs neither — see T-221',
    ).toEqual(Object.keys(ROUTE_POSTURE).sort());
  });

  it('declares no posture for a route that no longer exists', () => {
    const existing = new Set(apiRouteFiles());
    expect(Object.keys(ROUTE_POSTURE).filter((f) => !existing.has(f))).toEqual([]);
  });

  it.each(byteRoutes)('%s bounds its serverless time with maxDuration', (file) => {
    expect(
      sourceOf(file),
      `${file} serves stored bytes; without maxDuration a hung download bills open-ended time`,
    ).toMatch(/^export const maxDuration = \d+;$/m);
  });

  it.each(byteRoutes)('%s rate-limits per client IP', (file) => {
    const source = sourceOf(file);
    expect(source, `${file} must import the shared limiter from @/lib/rate-limit`).toMatch(
      /from '@\/lib\/rate-limit'/,
    );
    expect(source, `${file} must call rateLimit(...) before doing the expensive work`).toMatch(
      /await rateLimit\(\{/,
    );
    expect(
      source,
      `${file} must key its bucket on the client IP — an unauthenticated caller has no other identity`,
    ).toMatch(/getClientIp\(/);
  });

  it('gives /api/thumb a shorter ceiling than /api/watermark (no Sharp work)', () => {
    const read = (file: string) => {
      const match = sourceOf(file).match(/^export const maxDuration = (\d+);$/m);
      return Number(match?.[1]);
    };
    expect(read('thumb/[...path]/route.ts')).toBeLessThan(read('watermark/[...path]/route.ts'));
  });
});
