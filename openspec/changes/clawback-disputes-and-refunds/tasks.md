## 1. Kernel (pure, no Stripe, no DB)

- [x] 1.1 Rewrite `src/lib/payouts/clawback.ts` around a TARGET: `resolveClawbackTarget` (returns `null` when the charge total is unknown — no fallback), `targetReversedCents`, `reversalDeltaCents`, `reversalIdempotencyKey(payoutId, targetForRow)`
- [x] 1.2 Delete `computeReducedHoldCents` — holds and paid rows share one target function; their divergence is what produced the fail-open
- [x] 1.3 Add dispute predicates: `isChargeback` (not `warning_*`), `isDisputeOpen`, `isDisputeClosed`, covering all 8 SDK statuses including `prevented`
- [x] 1.4 New `src/lib/payouts/order-status.ts` — `resolveOrderStatus({fullyRefunded, chargebackOpen, chargebackLost})`
- [x] 1.5 Rewrite `test/unit/lib/payout-clawback.test.ts`: target math, idempotence under repeated application, refund↔dispute order-independence, unknown total ⇒ `null`
- [x] 1.6 New `test/unit/lib/order-status.test.ts` — truth table over the three facts

## 2. Schema

- [x] 2.1 Migration on top of `20260808000000`: add `payouts.frozen_by_dispute_id text`, with a comment stating that freeze and refund accounting are orthogonal
- [x] 2.2 `pnpm db:reset` and verify

## 3. Ledger queries

- [x] 3.1 `applyReversalToHolds` → target-based; NEVER updates `amount_cents`; uses `.select()` and treats "0 rows matched" as a reconciliation case
- [x] 3.2 `freezeHoldsForCharge` records `frozen_by_dispute_id`; `restoreHoldsForCharge` clears only rows carrying that id
- [x] 3.3 `getTotalPendingPayouts` subtracts `reversed_amount_cents`
- [x] 3.4 `releasePayoutReversal` stops taking a status argument — status is derived from `reversed_amount_cents` vs `amount_cents`
- [x] 3.5 New `listUnconfirmedReversals` for the phantom-reversal sweep

## 4. Retry worker

- [x] 4.1 `PayableRow` carries the payable amount; `toPayableRow` subtracts reversals
- [x] 4.2 Subtract at the two sites that bypass it: the stale-batch total and the post-claim recompute
- [x] 4.3 `findTransferByGroup` keeps probing with the ORIGINAL `amount_cents`; transfers send the payable amount
- [x] 4.4 A `transfer_failed` row with `reversed_amount_cents > 0` is never transferred — flagged for review
- [ ] 4.5 Claim individual rows out of `pending` before calling Stripe, as the batch path already does
- [x] 4.6 Phantom-reversal sweep (`reversed_at` set, `stripe_reversal_id` null, >30 min) alerting via `reportMoneyIncident`

## 5. Orchestrator + webhook

- [x] 5.1 `applyClawback` → `reconcileChargeClawback`: resolve the target once, abort entirely if unknown
- [x] 5.2 `charge.refunded` reconciles money, then writes the recomputed order status
- [x] 5.3 `charge.dispute.created`: freeze money always; touch access only for a real chargeback
- [x] 5.4 `charge.dispute.closed`: handle all four closing states (`lost`, `won`, `warning_closed`, `prevented`)
- [x] 5.5 All three cases recompute order status through `resolveOrderStatus` — no unconditional `completed`
- [x] 5.6 `assertOrdersResolved` in every case, including `dispute.closed`

## 6. UI

- [x] 6.1 Earnings payout history renders `amount_cents − reversed_amount_cents`

## 7. Tests + close-out

- [x] 7.1 Integration: redelivery ×3 of one partial refund leaves one value
- [x] 7.2 Integration: dispute → refund-to-settle → won leaves the order refunded and the photographer unpaid
- [x] 7.3 Integration: inquiry open + `warning_closed` never touches access; payout payable again
- [x] 7.4 Integration: `lost` with the charge fetch failing changes nothing and alerts
- [x] 7.5 Integration: a partially reversed `transfer_failed` row is never transferred
- [x] 7.6 Flip the two assertions that encode the old model (`stripe-webhook.test.ts:1993`, partial-refund access)
- [ ] 7.7 Update the OpenSpec design + delta specs to the new model
- [x] 7.8 `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm build`
- [ ] 7.9 `/code-review` again — the last pass is what caught that the previous fixes were wrong
