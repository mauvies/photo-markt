# Alert on dispute freeze failures, and give a stuck freeze a way out (T-265)

## Why

Two `catch` blocks on the dispute path write to the console and nothing else, and a selector
exclusion turns the first of them into a permanent loss.

- **A failed unfreeze strands the money forever.** A dispute closes in our favour,
  `restoreHoldsForCharge` throws (a DB blip), and the row keeps `frozen_by_dispute_id`.
  `listPayableHolds` refuses every row carrying that mark, and that function is the only thing that
  pays holds — so the debt is real, recorded, and permanently unpayable. Worse, the photographer is
  shown a plausible balance for it: an inquiry-frozen row stays `pending` and keeps counting in
  `getTotalPendingPayouts`, while a chargeback-frozen row leaves `pending` as the won dispute returns
  the sale to their `net`.
- **A failed freeze pays a disputed charge.** The mirror case: the row keeps its `hold_reason` and
  charge id with no freeze mark, so `listPayableHolds` picks it up and the retry cron pays money that
  is under dispute.

Both are invisible by construction. The `catch` must not throw — a 500 makes Stripe redeliver a money
operation — which is exactly why the failure has to be surfaced deliberately (the T-249 lesson).

## What Changes

- Both `catch` blocks call `reportMoneyIncident` instead of `console.error`. **The flow does not
  change**: no throw, no order-status change, still a 200 and still a `continue`.
- Two new incident kinds, one per failure, because they are opposite problems with opposite
  remediations: `dispute-freeze-failed` (a disputed charge may be paid) and `dispute-unfreeze-failed`
  (money is stuck).
- A new recovery sweep, as a step in the existing `retry-pending-payouts` worker, for rows whose
  freeze has outlived its dispute. It asks Stripe for that dispute's real status and **releases only
  the unambiguous case** (closed and not lost); everything it cannot resolve is reported once a day
  under its own kind, `dispute-freeze-stuck`.
- No migration, no new cron, and no change to the `lost` branch or any other part of the money flow.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `purchase-clawback`: adds two requirements — a failed freeze or unfreeze is alerted rather than
  logged, and a freeze that outlives its dispute is released or reported rather than left forever.

## Impact

- `src/app/api/stripe/webhook/route.ts` — the two `catch` blocks on `charge.dispute.created`/
  `.updated` and `charge.dispute.closed`.
- `src/lib/observability/report-money-incident.ts` — three new `MoneyIncidentKind` values.
- `src/lib/stripe/disputes.ts` (new) — classify one dispute by id; never throws.
- `src/database/queries/payouts.ts` — `listStaleDisputeFreezes`.
- `src/lib/inngest/functions/retry-pending-payouts.ts` — the sweep step and one new injected dep.
- Tests: `test/integration/api/stripe-webhook.test.ts`,
  `test/integration/inngest/retry-pending-payouts.test.ts`.
- Docs: `CLAUDE.md` (money path), `backlog/DECISIONS.md` §5, `ARCHITECTURE.md` §4.3.
- One new outbound Stripe read (`disputes.retrieve`), made only when a stale frozen row exists — zero
  calls in the normal case.
