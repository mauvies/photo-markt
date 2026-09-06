/**
 * Integration tests for `reconcileOrderPayouts` (T-255).
 *
 * The state under test is the one T-249's and T-252's alerts structurally cannot
 * see: a paid order that left NO row in `payouts`. Those two alert while the code
 * runs through a known exit; this sweep asks the resulting rows, so an exit
 * nobody enumerated is still caught. On 2026-07-28 exactly that state went
 * unnoticed for thirteen days.
 *
 * Drives the exported flow body directly against local Supabase with a
 * pass-through step and a stubbed Stripe probe — same shape as
 * `retry-pending-payouts.test.ts`. No Inngest runtime, no Stripe account.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ReconcileOrderPayoutsDeps,
  reconcileOrderPayouts,
  runReconcileOrderPayoutsFlow,
} from '@/lib/inngest/functions/reconcile-order-payouts';
import type { InngestStepRunner } from '@/lib/inngest/step';
import type { PaymentSettlement } from '@/lib/stripe/payment-intents';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// The alert channel is unit-tested on its own; here we only assert the worker
// reaches it, so a stub keeps Sentry and Resend out of the run.
vi.mock('@/lib/observability/report-money-incident', () => ({
  reportMoneyIncident: vi.fn(async () => undefined),
}));

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Seven hours ahead puts anything written "now" past the 6-hour grace window. */
const NOW_PAST_GRACE = Date.now() + 7 * HOUR_MS;
/** Thirty-one days ahead pushes it out the far side of the 30-day lookback. */
const NOW_PAST_LOOKBACK = Date.now() + 31 * DAY_MS;

const passthroughStep: InngestStepRunner = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

/** Stripe stub: every payment intent has settled unless a test says otherwise. */
function makeDeps(settlement: PaymentSettlement = { outcome: 'settled' }): {
  deps: ReconcileOrderPayoutsDeps;
  probe: ReturnType<typeof vi.fn>;
} {
  const probe = vi.fn(async () => settlement);
  return { deps: { retrievePaymentSettlement: probe as never }, probe };
}

async function seedOrder(opts: {
  amountCents?: number;
  status?: string;
  paymentIntentId?: string | null;
  /** Seeds a matching `payouts` row, i.e. the healthy case. */
  withPayout?: boolean;
}): Promise<string> {
  const sb = createServiceClient();
  const buyer = await createTestUser('TALENT');
  // `orders.stripe_payment_intent_id` is unique — a shared literal would make a
  // test that seeds two orders fail on the fixture instead of the assertion.
  const suffix = crypto.randomUUID().slice(0, 8);

  const { data: order, error } = await sb
    .from('orders')
    .insert({
      user_id: buyer.id,
      total_amount_cents: opts.amountCents ?? 999,
      currency: 'eur',
      status: opts.status ?? 'completed',
      stripe_payment_intent_id:
        opts.paymentIntentId === undefined ? `pi_seeded_${suffix}` : opts.paymentIntentId,
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(`order seed failed: ${error?.message}`);

  if (opts.withPayout) {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const { error: payoutError } = await sb.from('payouts').insert({
      photographer_id: photographer.id,
      amount_cents: opts.amountCents ?? 999,
      currency: 'eur',
      stripe_charge_id: `ch_${order.id.slice(0, 8)}`,
      status: 'pending',
      hold_reason: 'connect_inactive',
      order_id: order.id,
      order_kind: 'order',
    });
    if (payoutError) throw new Error(`payout seed failed: ${payoutError.message}`);
  }

  return order.id;
}

async function seedGuestOrder(opts: {
  amountCents?: number;
  status?: string;
  email?: string;
}): Promise<string> {
  const sb = createServiceClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await sb
    .from('guest_orders')
    .insert({
      guest_email: opts.email ?? `guest-${suffix}@photomarkt.test`,
      stripe_checkout_session_id: `cs_${suffix}`,
      stripe_payment_intent_id: `pi_guest_${suffix}`,
      total_amount_cents: opts.amountCents ?? 1500,
      currency: 'eur',
      status: opts.status ?? 'completed',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`guest order seed failed: ${error?.message}`);
  return data.id;
}

async function alerts() {
  const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
  return vi
    .mocked(reportMoneyIncident)
    .mock.calls.filter(([incident]) => incident.kind === 'order-without-payouts');
}

describe('reconcile-order-payouts — function config guard', () => {
  it('takes the fourth cron slot, clear of the other three', () => {
    // 0,30 cleanup-orphaned-storage · 15,45 reconcile-indexing · 10,40
    // retry-pending-payouts. CLAUDE.md requires a new cron to pick a free slot.
    expect(reconcileOrderPayouts.opts.triggers).toEqual([{ cron: '25,55 * * * *' }]);
  });

  it('never runs two passes at once', () => {
    expect(reconcileOrderPayouts.opts.concurrency).toEqual({ limit: 1 });
  });
});

describe('runReconcileOrderPayoutsFlow', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  it('reports a completed order that left no rows in `payouts`', async () => {
    // The T-255 regression: money in, nothing owed recorded, and no path-based
    // alert can see it because no code path ran.
    const orderId = await seedOrder({ amountCents: 99 });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(1);
    const [incident] = (await alerts())[0] ?? [];
    expect(incident?.context?.orderCount).toBe(1);
    expect(incident?.context?.totalCents).toBe(99);
    expect(incident?.context?.oldestOrderId).toBe(orderId);
    expect(incident?.context?.oldestOrderKind).toBe('order');
  });

  it('does NOT report an order whose payout row exists', async () => {
    await seedOrder({ withPayout: true });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.candidates).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('does NOT report an authenticated order whose payment has not settled', async () => {
    // The false positive the probe exists for: an `orders` row is written
    // `completed` the moment the session completes, but a delayed payment method
    // (SEPA and friends) leaves the session `unpaid`, so
    // `drivePayoutsForCheckoutSession` skips the transfers ON PURPOSE and waits
    // for `payment_intent.succeeded`. Nothing is owed yet, and that can last days
    // — far longer than any grace window could reasonably cover.
    await seedOrder({});

    const { deps } = makeDeps({ outcome: 'not-settled', status: 'processing' });
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.candidates).toBe(1);
    expect(result.unsettled).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('reports a guest order without probing Stripe at all', async () => {
    // `completeGuestOrder` is the LAST thing the guest branch does, after the
    // transfers (T-263), so `completed` there is already conclusive.
    await seedGuestOrder({ amountCents: 1500 });

    const { deps, probe } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(1);
    expect(probe).not.toHaveBeenCalled();
    const [incident] = (await alerts())[0] ?? [];
    expect(incident?.context?.oldestOrderKind).toBe('guest_order');
  });

  it('carries no buyer PII into the incident', async () => {
    const email = 'buyer-pii-check@photomarkt.test';
    await seedGuestOrder({ email });

    const { deps } = makeDeps();
    await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    const [incident] = (await alerts())[0] ?? [];
    expect(JSON.stringify(incident ?? {})).not.toContain(email);
  });

  it('leaves an order inside the grace window alone', async () => {
    // Delivery may still be in flight; Stripe redelivers a failed webhook.
    await seedOrder({});
    await seedGuestOrder({});

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, Date.now(), deps);

    expect(result.ordersScanned).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('drops an order out of the window past the lookback, so the set drains', async () => {
    // Pre-ledger orders (before T-216) legitimately have no `payouts` rows. With
    // no upper bound they would sit at the head of an `ORDER BY created_at ASC`
    // window forever, alerting daily and hiding real incidents behind the cap.
    await seedOrder({});

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_LOOKBACK, deps);

    expect(result.ordersScanned).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('ignores a free order — nothing was collected, so nothing is owed', async () => {
    await seedOrder({ amountCents: 0 });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.ordersScanned).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('ignores a non-completed order', async () => {
    await seedOrder({ status: 'pending' });
    await seedOrder({ status: 'refunded' });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.ordersScanned).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('does not let a guest order id vouch for an authenticated one', async () => {
    // `orders` and `guest_orders` are separate tables with independent uuid
    // spaces, which is why `payouts.order_id` carries no foreign key (T-216).
    // Matching on the id alone would silence a real incident.
    const orderId = await seedOrder({});
    const sb = createServiceClient();
    const photographer = await createTestUser('PHOTOGRAPHER');
    await sb.from('payouts').insert({
      photographer_id: photographer.id,
      amount_cents: 999,
      currency: 'eur',
      stripe_charge_id: 'ch_wrong_kind',
      status: 'pending',
      hold_reason: 'connect_inactive',
      order_id: orderId,
      // Same id, wrong table.
      order_kind: 'guest_order',
    });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(1);
    expect(await alerts()).toHaveLength(1);
  });

  it('alerts once per day, not once per cron pass', async () => {
    await seedOrder({});

    const { deps } = makeDeps();
    await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);
    await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);
    await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(await alerts()).toHaveLength(1);
  });

  it('aggregates the whole set into one incident, not one per order', async () => {
    await seedOrder({ amountCents: 100 });
    await seedOrder({ amountCents: 250 });
    await seedGuestOrder({ amountCents: 400 });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(3);
    const raised = await alerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.[0]?.context?.orderCount).toBe(3);
    expect(raised[0]?.[0]?.context?.totalCents).toBe(750);
  });

  it('reports a guest order stranded `pending` — the T-263 kill nothing else selects', async () => {
    // `createGuestOrder` writes `pending` and `completeGuestOrder` runs LAST,
    // after the transfers. A kill in between leaves the buyer charged, the
    // delivery unfinished and zero payout rows — invisible to buyer-facing reads
    // (they gate on `completed`) and to the retry worker (no row to drain).
    await seedGuestOrder({ status: 'pending', amountCents: 1200 });

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(1);
    expect(await alerts()).toHaveLength(1);
  });

  it('probes a `pending` guest order rather than assuming it was paid', async () => {
    // Unlike a `completed` guest order, `pending` says nothing about settlement.
    await seedGuestOrder({ status: 'pending' });

    const { deps, probe } = makeDeps({ outcome: 'not-settled', status: 'processing' });
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.unsettled).toBe(1);
    expect(await alerts()).toHaveLength(0);
  });

  it('still alerts when EVERY candidate is unverifiable, instead of going silent', async () => {
    // A Stripe outage used to make the sweep return before the alert step: no
    // incident, no log, 48 passes a day, forever.
    await seedOrder({});

    const { deps } = makeDeps({ outcome: 'unknown' });
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(result.confirmed).toBe(0);
    expect(result.unprobeable).toBe(1);
    const raised = await alerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.[0]?.context?.unverifiableOrderIds).toContain('order:');
    // ⚠️ It must NOT be asserted as settled debt.
    expect(raised[0]?.[0]?.context?.settledOrderIds).toBe('');
  });

  it('reports an authenticated order with no payment intent id instead of dropping it', async () => {
    // `drivePayoutsForCheckoutSession` alerts on this shape at the time, which
    // proves it happens on genuinely PAID sessions — so the sweep must not
    // silently exempt the order whose path-based alert is weakest.
    await seedOrder({ paymentIntentId: null });

    const { deps, probe } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(probe).not.toHaveBeenCalled();
    expect(result.unprobeable).toBe(1);
    expect(await alerts()).toHaveLength(1);
  });

  it('never tells the operator to transfer by hand', async () => {
    // T-249's rule. Stripe redelivers for up to three days and T-262's itemless
    // order is resumed by exactly that redelivery, so "pay this manually" off a
    // zero-rows observation is a double payment.
    await seedOrder({});

    const { deps } = makeDeps();
    await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    const message = (await alerts())[0]?.[0]?.message ?? '';
    expect(message).toMatch(/redelivery/i);
    expect(message).toMatch(/double payment/i);
    expect(message).not.toMatch(/reconciled by hand|nothing that will self-heal/i);
  });

  it('carries the completeness qualifiers, which a replay must not zero out', async () => {
    // Every one of these is computed OUTSIDE the earlier `step.run` bodies: on an
    // Inngest replay a completed step returns memoized output without re-running
    // its closure, so a counter mutated in-step is always 0 in production — and
    // these fields exist precisely to stop the alert reading as "that is all of
    // them".
    await seedOrder({});
    await seedGuestOrder({});

    const { deps } = makeDeps();
    const result = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    const context = (await alerts())[0]?.[0]?.context ?? {};
    expect(context.candidatesInspected).toBe(result.candidates);
    expect(context.candidatesInspected).toBe(2);
    expect(context.awaitingSettlement).toBe(0);
    expect(context.deferredToNextPass).toBe(0);
    expect(context.windowTruncatedPages).toBe(0);
  });

  it('reports `alerted` honestly once the daily claim is spent', async () => {
    await seedOrder({});

    const { deps } = makeDeps();
    const first = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);
    const second = await runReconcileOrderPayoutsFlow(passthroughStep, NOW_PAST_GRACE, deps);

    expect(first.alerted).toBe(true);
    // The throttled pass still FOUND the order; it just did not alert again.
    expect(second.alerted).toBe(false);
    expect(second.confirmed).toBe(1);
  });
});
