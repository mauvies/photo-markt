/**
 * Cron worker: find orders the buyer paid for that opened **no debt at all**
 * (T-255).
 *
 * On 2026-07-28 a €0.99 sale completed with zero `payouts` rows, and nobody knew
 * for thirteen days. T-249 and T-252 attacked the *causes* — every exit that can
 * complete an order without paying now alerts, and both payment events drive the
 * transfers instead of betting on Stripe's delivery order. But both of those
 * alert **as the code walks past them**. Nothing looked at the resulting state,
 * so an eighth exit, or a failure outside those paths, is silent all over again.
 *
 * This asks the question of the rows instead of the code path:
 *
 *   > a paid order, `total_amount_cents > 0`, past the grace window, with **no**
 *   > row in `payouts` for that `(order_id, order_kind)`.
 *
 * ## What it does NOT cover
 *
 * Two boundaries, stated so the sweep is not mistaken for more than it is:
 *
 *  - **Partially-paid orders.** The anti-join is existence-only, so a two-
 *    photographer cart that paid one of them reads as healthy. That is the
 *    ticket's scope, and the partial case already alerts from the other side
 *    (`createTransfersForOrderItems` raises `payout-not-recorded` on both exits
 *    that can skip a photographer mid-loop).
 *  - **Exits that never create an order row at all** — a guest session with no
 *    email or an empty cart, an authenticated one with no user or cart id. There
 *    is no row to anti-join against, so those stay path-alert territory.
 *
 * ## It reports, and does not repair
 *
 * Deliberate, and the same line T-265 draws: a cron never moves money. Re-driving
 * the transfers from here would mean re-deriving the charge, the split and the
 * plan rates outside the webhook that owns them, and getting it wrong pays a
 * photographer twice with no way back.
 *
 * ⚠️ **And for the same reason the alert never tells anyone to pay by hand.**
 * Zero rows in `payouts` proves nothing has been paid *yet*; it does not prove
 * nothing is *about to be*. Stripe redelivers a failed webhook for up to three
 * days, and T-262's itemless order is resumed by exactly that redelivery — so an
 * operator who transfers manually off this alert and then lets the redelivery
 * through pays twice, invisibly to `openPayoutRow`'s `(charge, photographer)`
 * guard. Same rule as every other alert on this path (T-249): state what is
 * certain and name the ledger as the authority.
 *
 * ## Why it is its own function and not a step of `retry-pending-payouts`
 *
 * That one holds `concurrency: { limit: 1 }` and a per-photographer debounce so
 * two payout runs can never overlap. A read-only sweep has no business competing
 * for that slot, and a slow Stripe read here must never delay a transfer there.
 *
 * Cron slot `25,55` — the fourth, offset from storage cleanup (`0,30`), indexing
 * reconciliation (`15,45`) and payout retries (`10,40`). It sits 15 minutes clear
 * of the payout retries on both sides, which is the one it would most plausibly
 * contend with for Supabase and Stripe.
 */

import { listCompletedGuestOrdersInWindow } from '@/database/queries/guest-orders';
import type { ReconcilableOrder, ReconciliationWindow } from '@/database/queries/orders';
import { listCompletedOrdersInWindow } from '@/database/queries/orders';
import type { PayoutOrderKind } from '@/database/queries/payouts';
import { listOrderIdsWithPayouts } from '@/database/queries/payouts';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import { inngest } from '@/lib/inngest/client';
import type { InngestStepRunner } from '@/lib/inngest/step';
import { reportMoneyIncident } from '@/lib/observability/report-money-incident';
import { rateLimit } from '@/lib/rate-limit';
import { retrievePaymentSettlement } from '@/lib/stripe/payment-intents';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/**
 * How long a paid order may sit without payout rows before it is a problem rather
 * than a delivery still in flight. Applied to `created_at` by the window queries,
 * and again to the Stripe settlement time for anything probed.
 *
 * Six hours covers the early part of Stripe's webhook retry schedule without
 * pushing detection past the same day. It does NOT cover the whole three-day
 * redelivery window, which is why the alert wording refuses to claim the state is
 * terminal rather than the window pretending to prove it.
 */
const GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * How far back the sweep looks — and the upper bound is the load-bearing half.
 *
 * Orders older than the ledger itself (pre-T-216) can legitimately have no
 * `payouts` rows: the rows did not exist to be written. With no lookback limit
 * those would sit permanently at the head of an `ORDER BY created_at ASC` window,
 * re-reported every single day and eventually hiding a genuinely broken order
 * behind the row cap. Same failure mode `clearDisputeFreezeMarks` had to solve
 * for stale freezes (T-265): a sweep whose input set never drains stops being a
 * sweep.
 *
 * The cost is stated rather than hidden: an order that goes unnoticed for more
 * than 30 days leaves the window (as does one that spends the window `disputed`
 * and is restored to `completed` after a 60–90 day chargeback). By then it will
 * have been reported once a day for thirty days.
 */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** Rows per page of the order window. */
const ORDER_PAGE_SIZE = 500;

/**
 * How many pages of each table the sweep will walk.
 *
 * ⚠️ **Paged rather than capped, and the difference is the whole point.** A bare
 * `LIMIT` on `created_at ASC` pins the sweep to the OLDEST N orders in the
 * window — overwhelmingly healthy ones — so once steady-state volume exceeds N
 * per 30 days, a break last week is never examined at all. Paging walks the whole
 * window; this budget only bounds the pathological case, and hitting it is
 * reported rather than absorbed.
 */
const MAX_ORDER_PAGES = 20;

/**
 * How many settlement probes the sweep may make in one pass.
 *
 * Each is a sequential Stripe round-trip inside a single Inngest step. In normal
 * operation this is **zero** — a candidate only exists if something already went
 * wrong. The cap bounds the pathological case (a webhook outage leaving hundreds
 * of orders unpaid) so the step cannot outlive its invocation.
 */
const MAX_SETTLEMENT_PROBES_PER_TICK = 25;

/**
 * The window the probe rotation advances on, matching the cron interval.
 *
 * ⚠️ Without rotation the cap does not defer, it **starves**: the candidate list
 * is rebuilt identically every pass and sorted oldest-first, and the sweep repairs
 * nothing, so the same first N candidates would consume every probe forever. A
 * stably `not-settled` head (a delayed payment settles over days) would then hide
 * every newer candidate until it aged out of the lookback entirely. Rotating the
 * start index gives every candidate a turn.
 */
const PROBE_ROTATION_MS = 30 * 60 * 1000;

/**
 * The cron runs 48×/day and an order with no payout rows does not fix itself, so
 * an alert per pass would be 48 identical emails a day. One claim per rolling
 * day, in Postgres so it holds across invocations — the same shape as
 * `report-unconfirmed-reversals` (T-264).
 */
const ALERT_WINDOW_SEC = 24 * 60 * 60;

/** How many ids of each bucket travel in the alert context. */
const MAX_IDS_IN_ALERT = 20;

export interface ReconcileOrderPayoutsResult {
  /** Paid, non-free orders inspected across both tables. */
  ordersScanned: number;
  /** Of those, the ones with no `payouts` row at all. */
  candidates: number;
  /** Candidates confirmed as money collected with nothing owed recorded. */
  confirmed: number;
  /**
   * Candidates whose payment Stripe says has NOT settled, or settled inside the
   * grace window — a delayed payment method mid-flight. Not an incident, and the
   * main reason this sweep probes at all.
   */
  unsettled: number;
  /**
   * Candidates the sweep could not get a verdict on: no payment intent id on the
   * row, Stripe did not know it, or the read failed. Never asserted as debt — but
   * never dropped either, because "we are blind here" is itself reportable.
   */
  unprobeable: number;
  /** Candidates left for a later pass by `MAX_SETTLEMENT_PROBES_PER_TICK`. */
  deferred: number;
  /** True if either table exhausted `MAX_ORDER_PAGES`. */
  windowTruncated: boolean;
  /** Whether this pass actually raised the incident (vs. the daily claim). */
  alerted: boolean;
}

/** Injected so the integration test can drive the flow without Stripe. */
export interface ReconcileOrderPayoutsDeps {
  retrievePaymentSettlement: typeof retrievePaymentSettlement;
}

const defaultDeps: ReconcileOrderPayoutsDeps = { retrievePaymentSettlement };

export const reconcileOrderPayouts = inngest.createFunction(
  {
    id: 'reconcile-order-payouts',
    // Read-only, but a second overlapping pass would only duplicate Stripe reads
    // and race the daily alert claim for no benefit.
    concurrency: { limit: 1 },
    // 25 and 55 past the hour — the fourth cron slot. See the file header.
    triggers: [{ cron: '25,55 * * * *' }],
    // ⚠️ A sweep whose whole job is observability must be observable itself. Every
    // query on this path throws, and a throw inside `step.run` is caught by the
    // SDK, retried, and then fails the RUN — which surfaces as a red entry in the
    // Inngest dashboard and nowhere else. A statement timeout on the window scan
    // would therefore silence this alert permanently while everything else looked
    // fine, which is the T-125 shape (prod ran 5 of 13 functions, nothing said so).
    onFailure: async ({ error }: { error: unknown }) => {
      await reportMoneyIncident({
        kind: 'payout-reconciliation-failed',
        message:
          'The order-payout reconciliation sweep failed every retry. While it is down, an order ' +
          'that was charged without opening any payout row is invisible again — this alert is ' +
          'about the missing check, not about a specific order.',
        cause: error,
      });
    },
  },
  async ({ step }: { step: InngestStepRunner }) => {
    return await runReconcileOrderPayoutsFlow(step, Date.now());
  },
);

/** A candidate order plus which table it came from. */
interface Candidate extends ReconcilableOrder {
  kind: PayoutOrderKind;
}

/** What step 1 hands to step 2. Returned, never assigned to a closure — see below. */
interface CollectOutcome {
  candidates: Candidate[];
  ordersScanned: number;
  windowTruncated: boolean;
}

/** What step 2 hands to step 3. */
interface ConfirmOutcome {
  confirmed: Candidate[];
  unprobeable: Candidate[];
  unsettled: number;
  deferred: number;
}

/**
 * Walk one table's whole window, page by page.
 *
 * Returns `truncated` when the page budget runs out rather than pretending the
 * last page was the end — the caller carries that into the alert.
 */
async function collectWindow(
  fetchPage: (window: ReconciliationWindow) => Promise<ReconcilableOrder[]>,
  kind: PayoutOrderKind,
  fromIso: string,
  toIso: string,
): Promise<{ rows: Candidate[]; truncated: boolean }> {
  const rows: Candidate[] = [];

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const batch = await fetchPage({
      fromIso,
      toIso,
      limit: ORDER_PAGE_SIZE,
      offset: page * ORDER_PAGE_SIZE,
    });
    rows.push(...batch.map((order) => ({ ...order, kind })));
    if (batch.length < ORDER_PAGE_SIZE) return { rows, truncated: false };
  }

  console.warn(
    `[reconcile-payouts] ${kind}: exhausted the ${MAX_ORDER_PAGES}-page budget ` +
      `(${rows.length} rows); the newest part of the window was not examined this pass.`,
  );
  return { rows, truncated: true };
}

/**
 * Does this candidate need a Stripe probe to mean anything?
 *
 * ⚠️ The asymmetry is a real property of the webhook, not an inconsistency. A
 * `guest_orders` row reaches `completed` only in `completeGuestOrder`, which is
 * the LAST thing that branch does, after the transfers (T-263) — so `completed`
 * there already means "the money moved, or tried to". Everything else is written
 * before settlement is known: an authenticated order is `completed` the moment
 * the session completes, and a guest order is born `pending`.
 */
function needsSettlementProbe(order: Candidate): boolean {
  return !(order.kind === 'guest_order' && order.status === 'completed');
}

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step, an explicit `nowMs` so the windows are deterministic,
 * and a stubbed Stripe probe).
 */
export async function runReconcileOrderPayoutsFlow(
  step: InngestStepRunner,
  nowMs: number,
  deps: ReconcileOrderPayoutsDeps = defaultDeps,
): Promise<ReconcileOrderPayoutsResult> {
  const fromIso = new Date(nowMs - LOOKBACK_MS).toISOString();
  const toIso = new Date(nowMs - GRACE_MS).toISOString();

  // ── 1. Collect the candidates ────────────────────────────────────────────
  // PostgREST cannot express the anti-join, so the subtraction happens here:
  // walk the window in each table, then ask the ledger which of those ids it
  // knows about. Both tables are queried with an explicit column list — never
  // `select('*')` — because `guest_orders` carries `guest_email` and every row
  // here is destined for an alert.
  const collected: CollectOutcome = await step.run('collect-orders-without-payouts', async () => {
    const [authed, guests] = await Promise.all([
      collectWindow(
        (window) => listCompletedOrdersInWindow(adminClient, window),
        'order',
        fromIso,
        toIso,
      ),
      collectWindow(
        (window) => listCompletedGuestOrdersInWindow(adminClient, window),
        'guest_order',
        fromIso,
        toIso,
      ),
    ]);

    const [authedPaid, guestsPaid] = await Promise.all([
      listOrderIdsWithPayouts(
        adminClient,
        'order',
        authed.rows.map((order) => order.id),
      ),
      listOrderIdsWithPayouts(
        adminClient,
        'guest_order',
        guests.rows.map((order) => order.id),
      ),
    ]);

    const candidates = [
      ...authed.rows.filter((order) => !authedPaid.has(order.id)),
      ...guests.rows.filter((order) => !guestsPaid.has(order.id)),
    ];

    // Oldest first: the alert names the oldest, and that is the one a human
    // should look at first.
    candidates.sort((a, b) => a.created_at.localeCompare(b.created_at));

    return {
      candidates,
      ordersScanned: authed.rows.length + guests.rows.length,
      windowTruncated: authed.truncated || guests.truncated,
    };
  });

  // ⚠️ Assigned OUTSIDE the step, as `retry-pending-payouts` documents: on an
  // Inngest replay a completed step returns its memoized value WITHOUT executing
  // the body, so a counter mutated inside the closure comes back 0. These fields
  // exist to stop the alert reading as "and that is all of them" — mutating them
  // in-step would guarantee they always did exactly that.
  const result: ReconcileOrderPayoutsResult = {
    ordersScanned: collected.ordersScanned,
    candidates: collected.candidates.length,
    confirmed: 0,
    unsettled: 0,
    unprobeable: 0,
    deferred: 0,
    windowTruncated: collected.windowTruncated,
    alerted: false,
  };

  if (collected.candidates.length === 0) return result;

  // ── 2. Establish which candidates are actually money we collected ────────
  const settlement: ConfirmOutcome = await step.run('confirm-settlement', async () => {
    const confirmed: Candidate[] = [];
    const unprobeable: Candidate[] = [];
    let unsettled = 0;
    let deferred = 0;

    // Guest orders that reached `completed` are already conclusive (T-263).
    confirmed.push(...collected.candidates.filter((order) => !needsSettlementProbe(order)));

    const askable = collected.candidates.filter(needsSettlementProbe);

    // No payment intent id ⇒ nothing to ask Stripe, so these cost no probe and
    // must not consume the budget. Counted and carried, never guessed: the shape
    // occurs on genuinely paid sessions (`drivePayoutsForCheckoutSession` alerts
    // on it at the time), so dropping it would exempt the one order whose
    // path-based alert is weakest.
    unprobeable.push(...askable.filter((order) => !order.stripe_payment_intent_id));

    const probeable = askable.filter((order) => order.stripe_payment_intent_id);
    // Rotate the start so the cap defers rather than starves (see the constant).
    const offset =
      probeable.length > 0 ? Math.floor(nowMs / PROBE_ROTATION_MS) % probeable.length : 0;

    for (let i = 0; i < probeable.length; i += 1) {
      const order = probeable[(offset + i) % probeable.length];
      const intentId = order?.stripe_payment_intent_id;
      if (!order || !intentId) continue;

      if (i >= MAX_SETTLEMENT_PROBES_PER_TICK) {
        deferred += 1;
        continue;
      }

      const verdict = await deps.retrievePaymentSettlement(intentId);

      if (verdict.outcome === 'settled') {
        // ⚠️ Known residual: the grace is anchored on `created_at`, and for a
        // delayed payment method settlement happens days later — so the first
        // pass that sees `succeeded` can fire minutes before the
        // `payment_intent.succeeded` delivery opens the payout rows. Stripe
        // exposes no settlement timestamp on a PaymentIntent to anchor on
        // instead (see `retrievePaymentSettlement`). It resolves itself on the
        // next pass, and the alert wording is what makes it safe: it names the
        // ledger as the authority and never asks for a manual transfer.
        confirmed.push(order);
        continue;
      }

      if (verdict.outcome === 'not-settled') {
        // The false positive this probe exists for: a delayed payment method
        // (SEPA Direct Debit and friends) leaves the session `unpaid`, so
        // `drivePayoutsForCheckoutSession` skips the transfers on purpose and
        // waits for `payment_intent.succeeded`. Nothing is owed yet.
        unsettled += 1;
        continue;
      }

      // `missing` or `unknown`. ⚠️ A failed or absent read is NEVER a verdict
      // (T-265) — it must not be asserted as debt. But it is not nothing either:
      // a candidate we can never verify is a blind spot, and blind spots are
      // exactly what this ticket exists to end, so it is reported as one.
      unprobeable.push(order);
    }

    confirmed.sort((a, b) => a.created_at.localeCompare(b.created_at));
    unprobeable.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { confirmed, unprobeable, unsettled, deferred };
  });

  result.confirmed = settlement.confirmed.length;
  result.unprobeable = settlement.unprobeable.length;
  result.unsettled = settlement.unsettled;
  result.deferred = settlement.deferred;

  // ⚠️ Reported when there is anything we cannot vouch for, not only when there
  // is proven debt. A pass where every candidate came back `unknown` used to exit
  // here in total silence — 48 times a day, forever.
  if (settlement.confirmed.length === 0 && settlement.unprobeable.length === 0) return result;

  // ── 3. One aggregated alert, once per rolling day ────────────────────────
  result.alerted = await step.run('report-orders-without-payouts', async () => {
    // A state, not a pass: the cron runs 48×/day and this does not fix itself.
    //
    // ⚠️ The claim GATES the send and therefore has to come first — reporting
    // before claiming makes the limiter observe an alert it can no longer
    // prevent, i.e. no throttle at all. The residual is accepted and shared with
    // `report-unconfirmed-reversals`: an invocation killed between the claim and
    // the send burns that day's claim. `rateLimit` fails OPEN, so a limiter
    // outage costs a duplicate alert rather than a missed one, which is the
    // direction this codebase chooses for money.
    const claim = await rateLimit({
      key: 'money-alert:order-without-payouts',
      limit: 1,
      windowSec: ALERT_WINDOW_SEC,
    });
    if (!claim.ok) return false;

    const { confirmed, unprobeable } = settlement;
    const oldest = confirmed[0] ?? unprobeable[0];
    const totalCents = [...confirmed, ...unprobeable].reduce(
      (sum, order) => sum + order.total_amount_cents,
      0,
    );

    // ⚠️ States what is certain and stops there. It must NOT say the money is
    // permanently stuck or ask for a manual transfer: Stripe redelivers a failed
    // webhook for up to three days and T-262's itemless order is resumed by
    // exactly that redelivery, so acting by hand on this alert without re-reading
    // the ledger first is a double payment (T-249's rule).
    await reportMoneyIncident({
      kind: 'order-without-payouts',
      message:
        `${confirmed.length + unprobeable.length} paid order(s) had no rows in \`payouts\` when ` +
        `this sweep ran (${confirmed.length} with the payment confirmed settled, ` +
        `${unprobeable.length} the sweep could not verify with Stripe). The buyer was charged and ` +
        'no debt to any photographer is recorded, so nothing will drain them. ⚠️ Re-read the ' +
        '`payouts` rows for each charge before acting — a webhook redelivery can still open them ' +
        'for up to three days, and a manual transfer on top of one is a double payment.',
      context: {
        orderCount: confirmed.length + unprobeable.length,
        totalCents,
        oldestOrderId: oldest?.id ?? null,
        oldestOrderKind: oldest?.kind ?? null,
        oldestCreatedAt: oldest?.created_at ?? null,
        currency: oldest?.currency ?? null,
        // Ids only — never `guest_email`, which is why the queries project an
        // explicit column list.
        settledOrderIds: confirmed
          .slice(0, MAX_IDS_IN_ALERT)
          .map((order) => `${order.kind}:${order.id}`)
          .join(','),
        unverifiableOrderIds: unprobeable
          .slice(0, MAX_IDS_IN_ALERT)
          .map((order) => `${order.kind}:${order.id}`)
          .join(','),
        // Named rather than dropped, so the alert can never read as "and that is
        // all of them" when it is not. All four are computed OUTSIDE the earlier
        // steps precisely so they survive an Inngest replay.
        candidatesInspected: result.candidates,
        awaitingSettlement: result.unsettled,
        deferredToNextPass: result.deferred,
        windowTruncatedPages: result.windowTruncated ? MAX_ORDER_PAGES : 0,
      },
    });

    return true;
  });

  return result;
}
