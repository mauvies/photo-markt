import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-202 regression: `src/app/api/billing/{checkout,cancel}/route.ts` were the
 * remnant of the pre-Server-Actions billing flow. They had zero callers, but
 * they were not inert — both were live `POST` endpoints reachable by ANY
 * authenticated user, and `checkout` wrote: it created a Stripe customer and
 * inserted a `subscriptions` row. It had also drifted from the action that
 * replaced it (locale-less `success_url` pointing at a different route, no
 * yearly billing, none of the typed `BillingCheckoutError` handling), so a user
 * who hit it directly got an old, broken subscription flow against real data.
 *
 * Source-level on purpose: a `fetch` against the route proves nothing in a unit
 * run (there is no server), and what must not come back is the FILE — Next's
 * app-router file convention is what makes the endpoint exist at all.
 */

const API_BILLING_DIR = join(process.cwd(), 'src/app/api/billing');

/** Every route handler file below `dir`, relative to it. Empty if `dir` is gone. */
function routeFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/^route\.(ts|tsx|js|jsx)$/.test(entry)) {
        found.push(full.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return found;
}

describe('dead billing API routes (T-202)', () => {
  it('exposes no route handler under src/app/api/billing/', () => {
    expect(
      routeFilesUnder(API_BILLING_DIR),
      'billing mutations go through the Server Actions in ' +
        'src/app/[lang]/dashboard/photographer/billing/actions.ts — a route handler here is a ' +
        'second, unreviewed way to create Stripe customers and subscription rows',
    ).toEqual([]);
  });

  it('keeps the Server Actions that replaced them', () => {
    // Guards the deletion from being widened: the routes are removable precisely
    // BECAUSE this file owns the live flow. If it ever disappears, the assertion
    // above would still pass while billing had silently lost its only surface.
    const actionsPath = join(
      process.cwd(),
      'src/app/[lang]/dashboard/photographer/billing/actions.ts',
    );
    expect(existsSync(actionsPath), 'the live billing Server Actions must exist').toBe(true);

    const source = readFileSync(actionsPath, 'utf8');
    expect(source).toContain('export async function createBillingCheckoutAction');
    expect(source).toContain('export async function cancelSubscriptionAction');
  });
});
