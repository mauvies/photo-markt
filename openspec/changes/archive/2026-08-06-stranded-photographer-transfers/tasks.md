## 1. Migration

- [x] 1.1 Create `supabase/migrations/20260807000000_add_payout_ledger.sql` adding `stripe_charge_id text`, `currency text`, `hold_reason text`, `order_id uuid` (nullable, no FK — guest orders live in `guest_orders`), `order_kind text check in ('order','guest_order')` and `transfer_batch_id uuid` to `public.payouts`, each with a ticket-prefixed `comment on column`
- [x] 1.2 Drop and re-add the status CHECK to include `'processing'` (drop-then-add, per `20260806000000`)
- [x] 1.3 Drop the `stripe_transfer_id` unique constraint **by name** (`payouts_stripe_transfer_id_key` from `20260501000000`; verify it survived the remote-schema dump) and keep the separate lookup index `idx_payouts_stripe_transfer_id`
- [x] 1.4 Add the partial unique index on `(stripe_charge_id, photographer_id) where stripe_charge_id is not null` and the sweep index on `(photographer_id, currency) where status = 'pending' and hold_reason is not null`
- [x] 1.5 Stamp pre-existing `pending` rows so they are identifiable as predating the ledger (D5)
- [x] 1.6 Drop the policies `"Photographers can create their own payouts"` and `"Photographers can cancel their own pending payouts"`; leave the SELECT policy in place
- [x] 1.7 Apply locally with `pnpm db:reset` and confirm the constraint/index/policy state

## 2. Queries and pure helpers

- [x] 2.1 Extend `PayoutStatus` with `'processing'` and `Payout` with the new columns in `src/database/queries/payouts.ts`
- [x] 2.2 Add `openPayoutRow` — insert `processing`, or `pending` + `hold_reason` when we already know no transfer will be attempted; return `null` on `23505` meaning another writer owns this `(charge, photographer)`
- [x] 2.3 Add `settlePayoutPaid(id, transferId)` and `holdPayoutRow(id, reason)`
- [x] 2.4 Add `listPayableHolds` filtering on `stripe_charge_id is not null and hold_reason is not null` (D5)
- [x] 2.5 Add `claimPayoutsForBatch` (batch id generated in SQL and read back from `returning`, per D9), `releaseClaimedPayouts` (D8) and `settleBatchAsPaid`
- [x] 2.6 Add `voidHoldsForCharge(chargeId)` (D10)
- [x] 2.7 Give `createPayoutFromTransfer` a **required** `stripe_charge_id` and make it log loudly on `23505` instead of swallowing it (D4)
- [x] 2.8 Widen `getTotalPendingPayouts` to include `'processing'` (D3) — without this `withdrawableBalanceCents` reports in-flight money as withdrawable
- [x] 2.9 Create `src/lib/payouts/batching.ts` with `STRIPE_MIN_TRANSFER_CENTS = 50` and a pure `splitPayableRows(rows)` returning individually-payable rows and sub-minimum groups keyed by `(photographer_id, currency)`
- [x] 2.10 Make `sourceTransaction` optional on `createTransfer` and add a transfer-lookup probe (`transfers.list({transfer_group})`) in `src/lib/stripe/connect.ts`

## 3. Webhook

- [x] 3.1 In `createTransfersForOrderItems`, compute `netCents` before the Connect gate and skip entirely when it is `<= 0`
- [x] 3.2 Rework the loop to open the ledger row before the Stripe call and settle it after (D1); a `null` from `openPayoutRow` means do nothing and transfer nothing
- [x] 3.3 Record `hold_reason` `connect_inactive` / `below_minimum` / `transfer_failed` on the three non-sending exits, each wrapped so a ledger failure cannot fail the webhook
- [x] 3.4 In `account.updated`, emit `payouts.retry-requested` when the derived status is `active` **and** a profile actually resolved
- [x] 3.5 In `charge.refunded`, call `voidHoldsForCharge` before the existing order update (D10)
- [x] 3.6 Update the handler's header event list, which `test/unit/api/stripe-webhook-setup-doc.test.ts` pins against the `switch`

## 4. Retry worker

- [x] 4.1 Create `src/lib/inngest/functions/retry-pending-payouts.ts` as a thin `inngest.createFunction` over an exported `runRetryPendingPayoutsFlow(step, nowMs, deps)`, matching `reconcile-indexing.ts`
- [x] 4.2 Declare a single function with `triggers: [{cron: '10,40 * * * *'}, {event: 'payouts.retry-requested'}]`, `concurrency: {limit: 1}` and a debounce keyed on the photographer id (D7)
- [x] 4.3 Implement the individual path: load payable holds, reconcile Connect per photographer (skip non-active), transfer each `>= 50` row with `source_transaction` and `payout_<row.id>`, settle
- [x] 4.4 Implement the aggregate path for sub-minimum rows: claim, re-check the minimum against the claimed rows and release when short (D8), transfer source-less, settle
- [x] 4.5 Implement stale-batch recovery: probe `transfers.list({transfer_group})`, cross-check destination and amount, and treat a failed probe as unknown → do not transfer
- [x] 4.6 Register the function in `src/app/api/inngest/route.ts`

## 5. Admin route

- [x] 5.1 In `src/app/api/admin/payouts/[id]/route.ts`, refuse any transition on a row that is `processing` or carries a `stripe_charge_id`, and keep `processing` out of `VALID_STATUSES` (D11)

## 6. Earnings UI and i18n

- [x] 6.1 Replace the "Available Balance / Ready to withdraw" card with a Pending payout card reading `summary.pendingPayoutsCents` (D12)
- [x] 6.2 Make `PayoutHistory` stop filtering on `stripe_transfer_id` and render each row's real status instead of the hardcoded "Paid"
- [x] 6.3 Add every new string to **both** `src/dictionaries/en.json` and `src/dictionaries/es.json`

## 7. Tests

- [x] 7.1 `test/unit/lib/payout-batching.test.ts` — the 50-cent split, grouping by `(photographer, currency)`, and that two currencies never merge
- [x] 7.2 `test/integration/api/stripe-webhook.test.ts` — inactive Connect writes a `connect_inactive` hold with the right net/charge/currency; net below the minimum writes `below_minimum`; a throwing `createTransfer` leaves one row in flight rather than creating a second; the happy path still writes exactly one paid row
- [x] 7.3 Same file — **the double-pay regression**: a redelivered `payment_intent.succeeded` after the worker already paid creates no second transfer
- [x] 7.4 Same file — `charge.refunded` voids an outstanding hold
- [x] 7.5 `test/integration/inngest/retry-pending-payouts.test.ts` — inactive photographer stays held then activation pays it (ticket criterion 1); two sub-minimum rows accumulate into one transfer and both settle (ticket criterion 2); a group still under the minimum stays held; a second run transfers nothing more; a short claim releases instead of wedging
- [x] 7.6 Same file — cron-config guard asserting the `10,40` slot, both triggers and `concurrency: {limit: 1}`
- [x] 7.7 Rewrite `test/integration/security/payouts-rls.test.ts` for the new posture: photographer cannot INSERT or UPDATE, SELECT of their own still works, service role still writes
- [x] 7.8 Update `test/integration/queries/payouts.test.ts` for the required `stripe_charge_id` on `createPayoutFromTransfer`

## 8. Docs and verification

- [x] 8.1 Update `ARCHITECTURE.md` §4.3 — the mermaid `log + skip (recoverable via admin endpoint later)` branch and the "there is no payout cron" claim both stop being true
- [x] 8.2 Update the `payouts` and Inngest sections of `CLAUDE.md`
- [x] 8.3 Run `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm build` (this change touches `src/lib/` and `src/database/queries/`, which only the build fully checks)
- [x] 8.4 Run `/code-review ultra` over the diff and fix real findings before committing
- [x] 8.5 File the follow-up ticket for the order-level sweeper (no charge id on the PI, guest-order redelivery short-circuit, photographer with no `profiles` row)
- [x] 8.6 Note in the PR body that the new Inngest function must be confirmed in the Inngest dashboard after deploy, since production has silently drifted before
