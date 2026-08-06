## 1. Schema

- [ ] 1.1 Add `supabase/migrations/20260808000000_add_payout_reversals_and_disputes.sql`: on `payouts`, add `reversed_amount_cents int not null default 0 check (reversed_amount_cents >= 0)`, `stripe_reversal_id text`, `reversed_at timestamptz`, and `void_reason text check (void_reason is null or void_reason in ('refund','dispute'))`
- [ ] 1.2 In the same migration, widen the three `status` CHECK constraints: `payouts` gains `'reversed'`, `orders` and `guest_orders` gain `'disputed'` (drop-and-recreate each constraint by name, as `20260807000000` does)
- [ ] 1.3 Write column/constraint comments carrying the *why* (`void_reason` exists so a won dispute restores only what the dispute voided; `amount_cents > 0` is deliberately kept, so a reduction to ≤ 0 must void instead)
- [ ] 1.4 `pnpm db:reset` and confirm the local stack applies it cleanly

## 2. Pure kernel

- [ ] 2.1 Create `src/lib/payouts/clawback.ts` with `refundRatio`, `isFullRefund`, `computeReversalCents` (delta, clamped to `[0, amount − alreadyReversed]`, floored), `computeReducedHoldCents` (survivor amount or `null` = void), and `reversalIdempotencyKey(payoutId, cumulativeReversedCents)`
- [ ] 2.2 Document in the module docstring: the ratio is taken against `charge.amount` (fee-inclusive) because Stripe refunds are amounts, not line items — and why the key is keyed on the cumulative amount rather than `(transfer, charge)`
- [ ] 2.3 Add `test/unit/lib/payout-clawback.test.ts` covering the proportional delta, clamping at the already-reversed total, the floor direction, the ≤ 0 survivor ⇒ void rule, and key derivation (same key on redelivery, different key for a larger second partial refund)

## 3. Stripe wrapper

- [ ] 3.1 Add `createTransferReversal({ transferId, amountCents, idempotencyKey })` to `src/lib/stripe/connect.ts`, passing the idempotency key in the request-options second argument exactly as `createTransfer` does

## 4. Ledger queries

- [ ] 4.1 Replace `voidHoldsForCharge` with `applyRefundToHolds(supabase, chargeId, ratio, voidReason)` in `src/database/queries/payouts.ts`: full ⇒ cancel (unchanged behaviour), partial ⇒ reduce `amount_cents`, voiding only when the survivor would be ≤ 0; stamp `void_reason`
- [ ] 4.2 Add `restoreHoldsForCharge(supabase, chargeId)` — `cancelled` + `void_reason = 'dispute'` back to `pending`
- [ ] 4.3 Add `listReversibleRowsForCharge(supabase, chargeId)` returning the `paid` and `processing` rows for a charge
- [ ] 4.4 Add `recordPayoutReversal(supabase, payoutId, { reversedCents, stripeReversalId })` — accumulate `reversed_amount_cents`, set `reversed_at`, flip status to `'reversed'` once fully reversed
- [ ] 4.5 Make `getTotalPaidOut` net of reversals: sum `amount_cents − reversed_amount_cents` over `('paid','reversed')`, with the docstring explaining the `withdrawableBalanceCents` identity it protects
- [ ] 4.6 Add `'reversed'` to the `PayoutStatus` union and fix the resulting typecheck error in `earnings-content.tsx`'s status map

## 5. Clawback orchestrator

- [ ] 5.1 Create `src/lib/payouts/apply-clawback.ts` exporting `applyClawback({ chargeId, reversedCents, chargeCents, reason })`, used by both the refund and the lost-dispute paths
- [ ] 5.2 Reduce or void outstanding holds first via `applyRefundToHolds`
- [ ] 5.3 For each reversible row, reverse the computed delta with `createTransferReversal` + `reversalIdempotencyKey`, then `recordPayoutReversal`
- [ ] 5.4 For a `processing` row, probe `findTransferByGroup(payoutTransferGroup(row.id), destination, amount)` first: `found` ⇒ settle paid then reverse; `none`/`unknown` ⇒ do nothing, record and alert (fail closed)
- [ ] 5.5 Ensure no per-row failure escapes: each is caught, recorded on the row and alerted, and the function always resolves

## 6. Observability

- [ ] 6.1 Create `src/lib/observability/report-money-incident.ts` — console.error plus a lazy `await import('@sentry/nextjs')` `captureException` with a stable fingerprint and `subsystem` tags, PII stripped, never throwing (pattern from `src/lib/rate-limit.ts`)
- [ ] 6.2 Create `src/lib/email/send-clawback-alert.ts` mirroring `send-face-search-alert.ts`
- [ ] 6.3 Add optional `OPS_ALERT_EMAIL` to `env.mjs`; absent ⇒ the email is a no-op

## 7. Webhook

- [ ] 7.1 Add `getGuestOrderByPaymentIntentId` to `src/database/queries/guest-orders.ts` (the column already exists — no migration)
- [ ] 7.2 Rewrite `case 'charge.refunded'` to call `applyClawback` with `charge.amount_refunded` / `charge.amount` and to flip the guest order as well as the authenticated one
- [ ] 7.3 Add `case 'charge.dispute.created'`: order + guest order → `disputed`, holds voided with `void_reason = 'dispute'`, alert
- [ ] 7.4 Add `case 'charge.dispute.closed'`: `lost` ⇒ `applyClawback` for `dispute.amount` + record the dispute fee from `dispute.balance_transactions` into order metadata as a platform cost + alert; `won` ⇒ order back to `completed`, `restoreHoldsForCharge`, alert; any other status logged and ignored
- [ ] 7.5 Wrap each new case so a clawback failure cannot 500 the webhook, matching how `voidHoldsForCharge` is already isolated
- [ ] 7.6 Update the header docstring — both the "Handles" list and the "Stripe Dashboard setup required" list — with the two dispute events, and refresh the stale "Transfer reversal is NOT automatic" note
- [ ] 7.7 Add the two events to the expected list in `test/unit/api/stripe-webhook-setup-doc.test.ts`

## 8. Integration tests

- [ ] 8.1 Mock `createTransferReversal` in `test/integration/api/stripe-webhook.test.ts` alongside the existing `createTransfer` mock
- [ ] 8.2 Dispute created: order and guest order become `disputed`, the outstanding hold is voided with the dispute reason
- [ ] 8.3 Dispute lost: a reversal is created for the photographer's net, the row records it, and `getTotalPaidOut` drops
- [ ] 8.4 Dispute won: the order returns to `completed` and the dispute-voided hold returns to `pending`, while a refund-voided hold stays voided
- [ ] 8.5 Full refund: reversal in full and the hold cancelled — T-216's existing refund test must not regress
- [ ] 8.6 Partial refund (the T-237 regression, red before the fix): the reversal is proportional and the hold survives with a reduced amount
- [ ] 8.7 Reversal failure: the webhook still returns 200, the row is marked and the incident is reported

## 9. Docs and close-out

- [ ] 9.1 Update `ARCHITECTURE.md` §4.3 — it currently states that a made transfer needs manual reversal and that T-215 owns automating it
- [ ] 9.2 Update the payouts section of `CLAUDE.md` with the clawback path, the `disputed`/`reversed` statuses and the proportional rule
- [ ] 9.3 Add `payoutStatusReversed` copy to `en.json` and `es.json`
- [ ] 9.4 Run `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm build` (`src/lib/` is touched)
- [ ] 9.5 Run `/code-review ultra` on the diff and fix the real findings before committing
- [ ] 9.6 Archive T-237 pointing at this PR instead of opening a separate branch, as its ticket instructs
