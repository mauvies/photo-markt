import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-220 regression: `src/app/api/admin/payouts/[id]/route.ts` was the whole
 * manual payout-approval flow — an endpoint that could set any status on any
 * payout row.
 *
 * It was built when `pending` had no producer. T-216 gave the status its real
 * meaning (a hold the `retry-pending-payouts` worker drains automatically) and
 * left the endpoint reachable only for rows that predate the ledger: it refuses
 * anything carrying a `stripe_charge_id`, and `openPayoutRow` always sets one.
 *
 * What made it worth deleting rather than finishing is narrower than "it was
 * unused": **a status change is not a transfer.** `updatePayoutStatus` wrote a
 * column and called no Stripe API, so the endpoint's one distinctive power was
 * making the ledger claim a payment that never happened — in a system where
 * T-249 made those rows the authority an operator reconciles Stripe against.
 * The actions it might otherwise have offered are automated (holds drain on
 * their own; `charge.refunded` voids them) or harmful (cancelling a hold makes
 * it permanently unpayable, because `payouts_charge_photographer_key` then
 * blocks a replacement row).
 *
 * Source-level on purpose, following `dead-billing-routes-removed.test.ts`
 * (T-202): a `fetch` proves nothing in a unit run, and what must not come back
 * is the FILE — Next's app-router file convention is what makes an endpoint
 * exist at all.
 */

const API_ADMIN_DIR = join(process.cwd(), 'src/app/api/admin');
const PAYOUT_QUERIES = join(process.cwd(), 'src/database/queries/payouts.ts');

/** Every route handler file below `dir`, relative to it. Empty if `dir` is gone. */
function routeFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/^route\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry)) {
        found.push(full.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return found;
}

/** Every .ts/.tsx source file below `dir`. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

describe('dead admin payout route (T-220)', () => {
  it('exposes no route handler under src/app/api/admin/', () => {
    expect(
      routeFilesUnder(API_ADMIN_DIR),
      'payout rows are written only by the transfer path and the retry worker, using the service ' +
        'role — an admin endpoint here can flip a row to `paid` without moving any money, which ' +
        'makes the ledger assert a payment that never happened',
    ).toEqual([]);
  });

  it('no longer ships the query helpers that only served it', () => {
    const source = readFileSync(PAYOUT_QUERIES, 'utf8');
    // `updatePayoutStatus` was the route's only dependency. `createPayout`
    // writes the exact shape T-216 had to quarantine — `pending` with no charge
    // id and no hold reason — which the retry worker excludes structurally.
    expect(source).not.toContain('updatePayoutStatus');
    expect(source).not.toContain('export async function createPayout(');
  });

  it('keeps every payout write inside the query layer', () => {
    // ⚠️ The assertions above are path- and name-scoped, and the capability
    // would not realistically come back the way it left. CLAUDE.md mandates
    // Server Actions for mutations, so a re-added payout-status writer would
    // land in some `actions.ts` with an inline
    // `supabaseAdmin.from('payouts').update(...)` — outside `api/admin/`, not
    // named `route.ts`, never touching this file, and every other test here
    // would stay green.
    //
    // So assert the capability instead: `payouts` is written by the query layer
    // only, which is where the ledger's ordering rules (reserve the row before
    // the Stripe call, never revert a claim) actually live. Any new writer has
    // to go through a reviewed helper there rather than reinventing them.
    const offenders = sourceFilesUnder(join(process.cwd(), 'src'))
      .filter((file) => file !== PAYOUT_QUERIES)
      .filter((file) => readFileSync(file, 'utf8').includes("from('payouts')"))
      .map((file) => file.slice(process.cwd().length + 1));

    expect(
      offenders,
      'a payout row must be written through src/database/queries/payouts.ts — an inline ' +
        "from('payouts') elsewhere is the manual status flip T-220 deleted, wearing a Server Action",
    ).toEqual([]);
  });

  it('keeps the ledger surface that replaced it', () => {
    // Guards the deletion from being widened: the route is removable precisely
    // BECAUSE the ledger owns this money end to end. If these disappeared, the
    // assertions above would still pass while payouts had lost their writer.
    const source = readFileSync(PAYOUT_QUERIES, 'utf8');
    expect(source).toContain('export async function openPayoutRow');
    expect(source).toContain('export async function settlePayoutPaid');
    expect(source).toContain('export async function listPayableHolds');

    expect(
      existsSync(join(process.cwd(), 'src/lib/inngest/functions/retry-pending-payouts.ts')),
      'the retry worker is what makes a hold recoverable without a human',
    ).toBe(true);

    // ⚠️ The file existing is not the worker running. Prod once had 5 of 13
    // Inngest functions synced, with the crons silently dead; a worker missing
    // from this array is exactly that failure, and since T-248 `connect_inactive`
    // is the ORDINARY way a hold is born — with the manual fallback now deleted.
    const inngestRoute = readFileSync(join(process.cwd(), 'src/app/api/inngest/route.ts'), 'utf8');
    expect(
      inngestRoute,
      'retry-pending-payouts must stay registered on the Inngest route, or holds never drain',
    ).toContain('retryPendingPayouts');
  });

  it('leaves admin_users with a live consumer', () => {
    // The May 2026 audit (finding C1) hardened this gate. Deleting the route
    // must not leave the pattern unexercised in `src/` — the admin status page
    // uses the same service-role lookup.
    const statusPage = join(process.cwd(), 'src/app/[lang]/dashboard/admin/status/page.tsx');
    expect(existsSync(statusPage)).toBe(true);

    const source = readFileSync(statusPage, 'utf8');
    expect(source).toContain("from('admin_users')");
    // The lookup is not the gate — this line is. Keeping only the query would
    // leave the page rendering per-service health and probe latencies to any
    // authenticated user while this test stayed green.
    expect(source, 'a non-admin must be refused, not merely looked up').toContain('if (!admin)');
  });
});
