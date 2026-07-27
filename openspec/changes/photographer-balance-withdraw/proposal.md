# Photographer balance & withdraw (inside Stripe Connect)

## Why

Today a sale only pays the photographer if their Stripe Connect account is `active` at the moment the
`payment_intent.succeeded` webhook fires; otherwise the transfer is **skipped with a `console.warn`** and
the money sits in the platform Stripe balance with **no structured record of who is owed what**. To avoid
selling photos we can't pay out, checkout **blocks** any cart containing a non-connected photographer —
producing the confusing buyer dead-end reported in T-189 (add to cart works, pay fails with an opaque
error). The fix at the root (T-190): make the sale always proceed by crediting the photographer's
**balance** in an append-only ledger, and transfer the accumulated balance automatically when their
Connect account becomes active. All funds stay inside Stripe's platform balance (standard "separate
charges and transfers" with deferred transfers) — no new payment rail, no custody outside Stripe.

## What Changes

- **New `ledger_entries` table** (append-only): every sale credits the photographer's net earnings;
  withdrawals and refund reversals debit it. Balance = `SUM(amount_cents)`, never a mutable column.
- **Webhook `payment_intent.succeeded`**: for an `active` photographer, behavior is unchanged
  (immediate transfer — zero blast radius for photographers who already get paid) except the transfer is
  now *also* recorded as credit+withdrawal in the ledger. For a **non-active** photographer, instead of
  `console.warn` + drop, the net amount is **credited** to their ledger balance.
- **Sub-minimum transfers** (net < 50¢): credited to the ledger instead of skipped — they accumulate
  until a future withdrawal clears the minimum (closes the "stranded cents" gap).
- **Webhook `account.updated` → `active`**: after syncing status, automatically **withdraws** the
  photographer's pending balance (one transfer for the accumulated net, idempotent, ledger-debited).
- **Checkout unblocked** (**BREAKING** for the current gate behavior): both checkouts (authenticated +
  guest) stop rejecting carts containing non-connected photographers — the sale always proceeds.
  This supersedes the main scope of T-189.
- **Earnings UI**: the photographer's earnings tab shows the pending balance ("accumulating until you
  connect payouts") so held funds are visible, not silent.
- **Refunds**: `charge.refunded` debits the ledger for orders whose credit was never withdrawn
  (balance netting). Refunds after withdrawal remain manual (documented, unchanged from today).
- **Reconciliation**: a periodic check (extend an existing Inngest cron) asserts
  `SUM(pending ledger balances) == expectation` and alerts on drift.

## Capabilities

### New Capabilities

- `photographer-earnings-ledger`: append-only ledger of photographer earnings (credits, debits,
  withdrawals); balance derivation; idempotency; integrity invariants; reconciliation.
- `deferred-payout-withdrawal`: crediting sales for non-active photographers instead of dropping them;
  automatic withdrawal of the accumulated balance on Connect activation; sub-minimum accumulation;
  refund netting against un-withdrawn balance; pending-balance visibility in the earnings UI.

### Modified Capabilities

- `cart-inventory-integrity`: the checkout validation requirement changes — the "photographer not
  connected → reject checkout" rule is removed (sales always proceed; payment-readiness no longer
  gates purchasability).

## Impact

- **DB**: new migration `ledger_entries` (RLS: photographer reads own rows; service-role writes only —
  same pattern as `rate_limit_buckets`/`admin_users` for writes). `payouts` table unchanged (stays the
  historical transfer record).
- **Webhook** `src/app/api/stripe/webhook/route.ts`: `createTransfersForOrderItems` (credit paths),
  `account.updated` handler (withdraw-on-activation), `charge.refunded` (ledger netting).
- **Checkout**: `src/app/[lang]/cart/actions.ts` (guest) + authenticated checkout action — remove the
  `photographerNotConnected` gate.
- **Queries**: new `src/database/queries/ledger.ts`; touches `sales.ts`/`earnings.ts` consumers only if
  the earnings tab reads the pending balance from the new query.
- **UI**: earnings tab (`/dashboard/photographer/sales?tab=earnings`) pending-balance card; new i18n
  strings in `en.json` + `es.json`.
- **Inngest**: extend `reconcile-indexing` cron or add a sibling for ledger reconciliation + alert.
- **Stripe surface**: stays on Accounts v1 (T-164 decision); uses only existing primitives
  (`transfers.create` with `source_transaction`/idempotency keys). No new Stripe products.
- **Compliance**: deferred transfers within the platform balance are a standard documented Stripe
  Connect pattern; DAC7/holding-window questions tracked in the design's compliance checklist
  (confirm-with-advisor items, not code blockers).
- **Backfill**: funds already stranded pre-ledger (historical skipped transfers) are reconstructed
  from completed `order_items`/`guest_order_items` with no matching `payouts` row — one-shot backfill
  task in the plan.
