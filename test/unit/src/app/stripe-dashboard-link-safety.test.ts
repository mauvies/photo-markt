/**
 * T-244 tripwires for the Stripe Express login link.
 *
 * Two properties that are one edit away from silently disappearing, and neither
 * would fail a typecheck or a render test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

describe('createStripeDashboardLinkAction takes no argument', () => {
  /**
   * ⚠️ A Stripe login link authenticates whoever holds it into that connected
   * account — payouts, bank details, balance. The action therefore resolves the
   * account id from the AUTHENTICATED USER'S OWN profile, and the fact that it
   * accepts no parameter at all is what makes "point it at someone else's
   * account" unrepresentable rather than merely unwise.
   *
   * Adding a parameter would compile, pass every render test, and turn this into
   * a self-service door into any photographer's money.
   */
  const source = read('src/app/[lang]/actions/stripe-dashboard.ts');

  it('declares an empty parameter list', () => {
    expect(source).toMatch(/export async function createStripeDashboardLinkAction\(\s*\)/);
  });

  it('reads the account id from the authenticated user, not from input', () => {
    expect(source).toContain('await supabase.auth.getUser()');
    expect(source).toContain('getProfileStripeConnect(supabase, user.id)');
  });

  it('refuses an account that is not active', () => {
    expect(source).toContain("connect?.stripe_connect_status !== 'active'");
  });
});

describe('the earnings page does not claim an unknown Connect status', () => {
  /**
   * The banner reads "connect your bank account to start receiving payouts".
   * Defaulting the status to `not_connected` while the query is in flight showed
   * that to photographers whose account is perfectly active, on every visit,
   * until the data arrived and it vanished — a loading state making a false claim
   * about someone's money.
   *
   * `?? null` plus an explicit null check is the whole fix, and `?? 'not_connected'`
   * is exactly as valid to the compiler.
   */
  // The fetch lives in `useRevenueData` (earnings-content) and the banner that
  // reads it lives on the Payouts tab, so the invariant spans two files.
  const hook = read('src/app/[lang]/dashboard/photographer/earnings/earnings-content.tsx');
  const banner = read('src/app/[lang]/dashboard/photographer/sales/payouts-content.tsx');

  it('falls back to null, never to a definite status', () => {
    expect(hook).toContain('connectStatus: data?.connectStatus ?? null,');
    expect(hook).not.toContain("data?.connectStatus ?? 'not_connected'");
  });

  it('renders the banner only once the status is known', () => {
    expect(banner).toContain("connectStatus !== null && connectStatus !== 'active'");
  });
});

describe('no surface promises a payout schedule the platform does not set', () => {
  /**
   * The product told photographers they were paid "every Monday" and needed a
   * "$25 minimum balance". Neither was true: the platform sets no payout schedule
   * (not in `createExpressAccount`, not in the Stripe dashboard, where connected
   * accounts are allowed to manage their own) and Stripe has no such minimum
   * setting. Both numbers were invented and shown to the person whose money it is.
   */
  const dictionaries = ['src/dictionaries/en.json', 'src/dictionaries/es.json'];

  it.each(dictionaries)('%s names no fixed payout day or minimum', (path) => {
    const source = read(path);
    expect(source).not.toMatch(/every Monday|cada lunes/i);
    expect(source).not.toMatch(/weekly payouts|pagos automáticos semanales/i);
    expect(source).not.toMatch(/Minimum balance required|Balance mínimo requerido/i);
  });

  /**
   * The pending balance said "In Stripe fraud-check window" — in Spanish, "En
   * revisión de fraude de Stripe", which reads as *Stripe is investigating me
   * for fraud*. Nothing is under review: the charge succeeded and was captured,
   * and the money is simply inside the account's payout delay. Telling a
   * photographer their first sale is a fraud case is the most alarming way
   * possible to describe a routine wait.
   */
  it.each(dictionaries)('%s does not describe the payout delay as a fraud review', (path) => {
    const source = read(path);
    expect(source).not.toMatch(/fraud-check|fraud check|revisión de fraude/i);
  });

  it('createExpressAccount still sets no payout schedule, which is why the copy cannot name one', () => {
    expect(read('src/lib/stripe/connect.ts')).not.toContain('payouts: { schedule');
  });
});
