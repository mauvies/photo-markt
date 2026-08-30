## 1. Incident kinds

- [x] 1.1 Add `dispute-freeze-failed`, `dispute-unfreeze-failed` and `dispute-freeze-stuck` to
      `MoneyIncidentKind` in `src/lib/observability/report-money-incident.ts`, each with a docblock
      naming its consequence and why it is not folded into an existing kind
- [x] 1.2 Confirm `subsystemFor` needs no change (all three are `payouts`)

## 2. Make the two webhook failures visible

- [x] 2.1 Replace the `console.error` in the `freezeHoldsForCharge` catch
      (`src/app/api/stripe/webhook/route.ts`, `charge.dispute.created`/`.updated`) with
      `reportMoneyIncident({ kind: 'dispute-freeze-failed', … cause: err })`, context
      `{ chargeId, disputeId, disputeStatus, orderId, chargeback }`
- [x] 2.2 Replace the `console.error` in the `restoreHoldsForCharge` catch (`charge.dispute.closed`)
      with `reportMoneyIncident({ kind: 'dispute-unfreeze-failed', … cause: err })`, context
      `{ chargeId, disputeId, disputeStatus, orderId }`
- [x] 2.3 Verify nothing else in either branch changed: no `throw`, no order-status write, same 200

## 3. Classify a dispute at Stripe

- [x] 3.1 Add `src/lib/stripe/disputes.ts` with `retrieveDisputeOutcome(disputeId)` returning
      `{ outcome: 'open' | 'closed-not-lost' | 'lost' | 'missing' | 'unknown', status? }`
- [x] 3.2 Build it on `isDisputeOpen` (`src/lib/payouts/clawback.ts`) and `isStripeResourceMissing`
      (`src/lib/stripe/resource-missing.ts`); it must never throw — a read failure is `unknown`

## 4. Selector for stale freezes

- [x] 4.1 Add `listStaleDisputeFreezes(supabase, frozenBeforeIso, limit)` to
      `src/database/queries/payouts.ts`: `frozen_by_dispute_id` not null, `updated_at` before the
      cutoff, oldest first, bounded
- [x] 4.2 Document in its docblock that `updated_at` is the freeze clock (trigger-maintained) and that
      the partial index `payouts_frozen_by_dispute_idx` already covers the predicate — no migration

## 5. The sweep

- [x] 5.1 Add `retrieveDisputeOutcome` to `RetryPayoutsDeps` and `defaultDeps` in
      `src/lib/inngest/functions/retry-pending-payouts.ts`
- [x] 5.2 Add `STALE_FREEZE_AGE_MS` (6 h) and `FREEZE_STUCK_ALERT_WINDOW_SEC` (24 h), each with the
      reasoning in a comment
- [x] 5.3 Add the step `release-stale-dispute-freezes` after `report-unconfirmed-reversals` and before
      `resolve-payable-holds`; group rows by `(frozen_by_dispute_id, stripe_charge_id)` so Stripe is
      read once per dispute
- [x] 5.4 Per dispute: `open` and `lost` → untouched and unreported; `closed-not-lost` →
      `restoreHoldsForCharge`, counted, logged; a throw from it, plus `missing` and `unknown` →
      collected as unresolved
- [x] 5.5 Raise one aggregated `dispute-freeze-stuck` incident for the unresolved set (count, oldest,
      up to 20 ids), claimed with `rateLimit({ key: 'money-alert:dispute-freeze-stuck', limit: 1,
      windowSec: FREEZE_STUCK_ALERT_WINDOW_SEC })`
- [x] 5.6 Add `freezesReleased` and `freezesUnresolved` to `RetryPayoutsResult`

## 6. Regression tests

- [x] 6.1 In `test/integration/api/stripe-webhook.test.ts`, add `freezeHoldsForCharge` and
      `restoreHoldsForCharge` to the existing `vi.fn(actual.*)` wrapper of
      `@/database/queries/payouts`
- [x] 6.2 Case B: the freeze throws → 200, `reportMoneyIncident` called with `dispute-freeze-failed`,
      and the row is still returned by `listPayableHolds`
- [x] 6.3 Case A: the restore throws → 200, kind `dispute-unfreeze-failed`, and the row keeps
      `frozen_by_dispute_id`
- [x] 6.4 In `test/integration/inngest/retry-pending-payouts.test.ts`: a `won`/`warning_closed`
      dispute releases the freeze and the row is paid in the same pass
- [x] 6.5 A `lost` dispute leaves the row frozen and raises no alert (the permanent false positive
      that decided the design)
- [x] 6.6 An open dispute leaves the row frozen and raises no alert
- [x] 6.7 An `unknown` outcome releases nothing and alerts once; a second pass the same day does not
      alert again
- [x] 6.8 A freeze inside the staleness window is neither read from Stripe nor reported
- [x] 6.9 Confirm each new test fails before its implementation task and passes after

## 7. Documentation

- [x] 7.1 `CLAUDE.md`, money-path section: both catches alert; the sweep is the only exit for a failed
      unfreeze; its own kind per T-264; it consults Stripe and repairs only the unambiguous case
- [x] 7.2 `backlog/DECISIONS.md` §5: a T-265 entry with the two facts that stop T-264's
      "report, don't repair" from transferring
- [x] 7.3 `ARCHITECTURE.md` §4.3: name the sweep in the dispute flow

## 8. Verification

- [x] 8.1 `pnpm typecheck && pnpm lint`
- [x] 8.2 `pnpm test:unit` and `pnpm vitest run test/integration`
- [x] 8.3 `/code-review high` on the diff, plus three parallel refutation subagents (paid-without-
      transfer · double payment · silent failure), and fix any reproducible finding

## 9. Findings from that review (all four reviewers, independently)

- [x] 9.1 CRITICAL — releasing with `restoreHoldsForCharge` alone restored a chargeback-frozen row at
      FULL value: both clawback selectors skip a `cancelled` row, so a refund landing while it was
      frozen recorded nothing on it. The sweep now **refuses** to release any charge whose Stripe
      `amount_refunded > 0`, or that it cannot read (`retrieveChargeRefundState`, fail-closed)
- [x] 9.2 The selector never drained: a lost dispute keeps its mark forever, and those rows sit at
      the head of `updated_at ASC` permanently, hiding stranded freezes behind the row cap. Added
      `clearDisputeFreezeMarks`, applied on a confirmed-`lost` dispute whose clawback is already
      recorded (never to a `pending` row with nothing reversed)
- [x] 9.3 Bounded the Stripe reads per pass (`MAX_FREEZE_DISPUTES_PER_TICK`), with the overflow named
      in the alert as `deferredDisputes` — no silent cap
- [x] 9.4 The order half: refuse to release while the order is still `disputed` (new
      `getOrderStatusById` / `getGuestOrderStatusById`), or the hold is paid for a sale that is out
      of `net` and locked to the buyer
- [x] 9.5 The selector read no longer aborts the run — recovery must not gate the paying steps
- [x] 9.6 Counts assigned OUTSIDE `step.run` (a counter mutated inside reads 0 after an Inngest
      replay), `oldest` sorted before it is named, `oldestChargeId` added to the alert
- [x] 9.7 Corrected the webhook comment that overclaimed `charge.dispute.updated` as a retry for a
      failed freeze — a dispute can go straight from `needs_response` to `closed`
- [x] 9.8 Five new regression tests for the refusals and the drain; full suite re-run
