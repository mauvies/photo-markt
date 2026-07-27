# Design — Photographer balance & withdraw (inside Stripe Connect)

## Context

Current model (verified in `ARCHITECTURE.md §4.3` + `src/app/api/stripe/webhook/route.ts:65-142`):

- **Passthrough**: `payment_intent.succeeded` → `createTransfersForOrderItems` groups the order's items
  per photographer and fires one `stripe.transfers.create` per photographer, immediately, with
  idempotency key `transfer_<chargeId>_<photographerId>` and `source_transaction: chargeId`.
  `createPayoutFromTransfer` records it in `payouts` (`status='paid'`).
- **Non-active photographer** → `console.warn` + `continue`: funds stay in the platform Stripe balance
  with **no structured record**. Recovery is manual archaeology.
- **Net < 50¢** → skipped with a warn: cents stranded forever.
- **Checkout gate**: both checkouts reject any cart containing a photographer whose
  `stripe_connect_status !== 'active'` (`cart/actions.ts:170-177` + authenticated twin). This is the
  buyer-facing dead-end this change removes.
- **Refunds**: `charge.refunded` marks the order refunded; transfers are never auto-reversed (manual
  via Stripe Dashboard, documented in the webhook header).
- Fees: `getPhotographerNetCents(gross, planId)` — plan-dependent commission (12/8/5%); the platform
  absorbs the Connect fee. Single currency today (EUR prices, one platform balance).

Constraints:

- Stay on **Accounts v1** (T-164 decision) — only `transfers.create`, `accounts.*` v1 shapes.
- Stripe requires transfers referencing a charge (`source_transaction`) to be created within the
  charge's availability window; deferred transfers past that window must draw on the **platform
  balance** instead (plain `transfers.create` without `source_transaction`).
- Webhook handler is the only money writer today; keep it that way (service-role, RLS-locked tables).

## Goals / Non-Goals

**Goals:**

1. A sale **always succeeds** regardless of the photographer's Connect state.
2. Every cent owed to a photographer is **recorded in an append-only ledger** the moment the sale
   completes — no more warn-and-drop.
3. When a photographer's account becomes `active`, their accumulated balance is **transferred
   automatically** — no manual claim step.
4. Zero behavior change for photographers who are already `active` (immediate transfer preserved).
5. Held funds are **visible** to the photographer (pending balance in the earnings tab).

**Non-Goals:**

- No new payment rails (Wise/PayPal/SEPA) — explicitly deferred.
- No manual "withdraw" button / partial withdrawals — v1 withdraws the full balance on activation.
- No automatic transfer reversal for refunds **after** withdrawal (stays manual, as today).
- No multi-currency ledger (single-currency `eur`-denominated cents; column reserved for later).
- No migration to Stripe Accounts v2 (T-164).
- No changes to the buyer-side purchase/download flow.

## Decisions

### D1 — Ledger as append-only `ledger_entries`; balance is always `SUM`

```sql
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('sale_credit','withdrawal','refund_debit','adjustment')),
  amount_cents int not null,          -- signed: credits > 0, debits < 0
  currency text not null default 'eur',
  order_id uuid,                      -- sale_credit/refund_debit provenance (auth orders)
  guest_order_id uuid,                -- same for guest orders
  stripe_charge_id text,              -- sale provenance + idempotency component
  stripe_transfer_id text,            -- withdrawal provenance
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);
```

- **Why append-only + SUM, not a `balance` column**: a mutable balance column and its update sites are
  where double-credit/lost-update bugs live. `SUM(amount_cents) where photographer_id = X` is trivially
  auditable, and the `idempotency_key` unique constraint makes every write idempotent at the DB level
  (a webhook retry inserts `on conflict do nothing` → zero effect). Volume is tiny (entries ≈ order
  items), so SUM needs no materialization; add an index on `(photographer_id)`.
- **Idempotency keys** mirror the Stripe convention already in use:
  `sale_<chargeId>_<photographerId>`, `withdrawal_<transferId>`, `refund_<chargeId>_<photographerId>`.
- **RLS**: enable; photographer `select` own rows (`photographer_id = auth.uid()`); **no**
  insert/update/delete policies for `anon`/`authenticated` (service-role only writes) — the
  `admin_users`/`rate_limit_buckets` pattern from CLAUDE.md.
- **Alternative considered — evolve `payouts`**: rejected. `payouts` semantics are "a transfer that
  happened" (status `paid`, admin flow legacy); shoehorning credits/debits in would overload its
  status machine and break its existing readers (`getPhotographerEarnings` summary). `payouts` stays
  as-is; a withdrawal still writes its `payouts` row via `createPayoutFromTransfer` (earnings summary
  keeps working unchanged).

### D2 — Active photographers keep the immediate transfer (passthrough preserved)

On `payment_intent.succeeded`, per photographer:

- **`active`** (after the existing `reconcileAndPersistConnectStatus` heal): transfer immediately as
  today, then write **two ledger entries in the same handler**: `sale_credit +net` and
  `withdrawal -net` (net zero). The ledger is thus a **complete** earnings journal for everyone, while
  the money path for active photographers is byte-for-byte what it is today.
- **Non-active**: write `sale_credit +net` only. No transfer. (This replaces the `console.warn` drop.)
- **Net < 50¢**: same as non-active — credit and accumulate, even for active photographers (a 30¢ net
  credit sits in the balance until a later sale or the activation sweep clears the 50¢ minimum).
  Closes the stranded-cents gap with no special casing.

**Why not route everyone through balance + deferred sweep?** Blast radius. Active photographers (the
paying, working population) would move from "paid on sale" to "paid on sweep" for zero benefit, and
`source_transaction` (which ties the transfer to the charge's own funds availability) only works on the
immediate path. Preserving it means the risky new code path only ever runs for photographers who today
get **nothing**.

### D3 — Withdrawal fires automatically on activation (no button)

In the `account.updated` handler, after `updateProfileStripeConnect` when the derived status
transitions to `active`:

1. Compute balance = `SUM(ledger_entries)` for the photographer.
2. If balance ≥ 50¢: `transfers.create({ amount: balance, destination, idempotencyKey:
   'withdrawal_activation_<accountId>_<balanceCents>_<latestEntryId>' })` — **no** `source_transaction`
   (accumulated credits may reference old charges; the transfer draws on the platform balance, which is
   the standard deferred-transfers pattern).
3. Write `withdrawal -balance` ledger entry (idempotency key from the transfer) + `payouts` row.
4. Failure → log + leave balance intact; the next `account.updated` event (or the reconciliation
   cron's re-drive) retries. Never partially debit.

**Why automatic instead of a "Withdraw" button:** the photographer completing Connect onboarding *is*
the expression of intent to get paid — a second manual step is friction with no upside at this scale.
A button also creates a new user-triggered money path (rate limiting, double-click idempotency, CSRF
surface) for no benefit. The earnings tab shows the pending balance and, post-activation, the
withdrawal appears as a payout row — same visibility a button would give.
**Alternative considered — scheduled sweep cron for active photographers with residual balance**: kept
as a *reconciliation* concern (see D6), not a primary flow; `account.updated` fires reliably on
activation and re-fires on subsequent account changes, giving natural retries.

### D4 — Refunds net against the un-withdrawn balance only

In `charge.refunded`: for each photographer credited from that charge, if a `sale_credit` exists for
`(chargeId, photographerId)` **and no withdrawal has consumed it** (balance still ≥ the credited
amount), write `refund_debit -net`. If the credit was already withdrawn, do nothing automatic — the
existing manual-reversal doc applies (unchanged from today).

- **Negative balances are permitted but not manufactured**: we never debit below what the un-withdrawn
  history supports, so a refund can only claw back money not yet sent. This avoids v1 having to build
  negative-balance collection (invoicing the photographer), which is real complexity with ~zero
  expected volume today.
- Partial refunds debit proportionally (`amount_refunded` ratio applied to the net credit, rounded
  down — platform absorbs the rounding cent, consistent with absorbing Stripe fees).

### D5 — Checkout gate removal is total, not conditional

Both checkout actions drop the `photographerNotConnected` rejection entirely (no "warn but allow"
state). Purchasability is no longer coupled to payment-readiness — the ledger guarantees the debt is
recorded. The `stripeConnect.checkout.photographerNotConnected` dict keys are removed with their only
call sites. T-189's tooltip/disable scope dies here; its typed-error sub-item is inherited by the
general checkout error handling (already patterned in T-045).

### D6 — Reconciliation: extend the cron, alert on drift

A sibling Inngest cron function (same file pattern as `reconcile-indexing`) runs daily:

1. **Invariant check**: `SUM(all ledger balances) ≥ 0` per photographer, and global pending total
   equals `SUM(sale_credits) - SUM(withdrawals) - SUM(refund_debits)` (self-consistency).
2. **Stranded-balance re-drive**: any photographer with balance ≥ 50¢ AND `stripe_connect_status =
   'active'` (activation event was missed/failed) → run the D3 withdrawal.
3. **Drift alert**: platform Stripe balance available < total pending ledger balance → Resend email
   (reuse the `FACE_SEARCH_ALERT_EMAIL` alert pattern; new env `LEDGER_ALERT_EMAIL`, absent ⇒ no-op).
   This is the "we owe more than we hold" tripwire — should never fire; if it does, refund/dispute
   flows have outpaced the ledger and a human must look.

### D7 — Backfill of pre-ledger stranded funds

One-shot script (executed via MCP/SQL after deploy, like past manual migrations): for every completed
`order_items`/`guest_order_items` row whose photographer has **no** `payouts` row covering it (net
computed with the plan commission **at backfill time** — historical plan lookup is not reconstructable
and the delta is small), insert `sale_credit` entries with idempotency keys derived from the historical
charge ids. Reviewed by hand before running (prod has no real users yet, so expected volume ≈ test
data only — the review is cheap).

## Compliance checklist (confirm before enabling in a real-users environment)

| Item | Status |
|---|---|
| Deferred transfers from platform balance are a documented, supported Connect pattern ("separate charges and transfers", holding funds for unonboarded recipients) | ✅ standard Stripe pattern; no new agreement needed |
| Maximum holding window before funds must be transferred/refunded (Stripe recommends timely payouts; some jurisdictions cap holding periods) | ⚠️ confirm with Stripe docs/support for ES/BE (target markets); design mitigation: funds auto-release on activation, and stale balances surface in the D6 report |
| DAC7 reporting (EU marketplace seller-income reporting) — thresholds: >29 sales or >€2k/yr per seller | ⚠️ pending advisor confirmation; ledger gives the per-photographer annual totals needed either way |
| Platform absorbs commission/fees; photographer receives promised net (unchanged) | ✅ no change |
| No custody outside Stripe (no bank account holding third-party funds) | ✅ by construction — funds never leave the Stripe platform balance |

## Risks / Trade-offs

- [Webhook does more DB writes in the money path] → all ledger writes are idempotent single-row
  inserts; a failure after the transfer but before the ledger write is healed by D6's invariant check
  (the `payouts` row + transfer idempotency key make the money itself safe).
- [Activation withdrawal draws on platform balance; a large refund could leave the platform balance
  short] → D6 drift alert; at current scale platform balance ≫ pending ledger.
- [Refund-after-withdrawal remains manual] → explicitly accepted (same as today), documented.
- [Ledger and `payouts` overlap conceptually] → deliberate: `payouts` = transfer history (existing
  readers untouched), ledger = debt journal. The withdrawal writes both; D6 checks they agree.
- [Backfill mis-crediting] → script is reviewed, idempotent, and prod currently has no real users.

## Migration Plan

1. **PR 1 — schema + queries** (child ticket 1): `ledger_entries` migration + `queries/ledger.ts`
   (insert helpers with `on conflict do nothing`, balance query) + unit/integration tests. No behavior
   change. ⚠️ prod migration must be applied manually via MCP while `migrate.yml` is billing-blocked.
2. **PR 2 — webhook credits** (child ticket 2): D2 (credit paths incl. sub-minimum + dual-entry for
   active) + D4 (refund netting). Regression tests against the local webhook suite.
3. **PR 3 — withdrawal on activation** (child ticket 3): D3 + D6 cron + alert env. Integration tests.
4. **PR 4 — unblock checkout + UI** (child ticket 4): D5 (both checkouts) + pending-balance card +
   i18n. Only merged once PRs 1–3 are deployed and D7 backfill has run (order matters: never sell
   un-ledgered).
5. **Rollback**: PR 4 is the only user-visible switch — reverting it restores the current gate while
   the ledger keeps accruing correctly underneath. PRs 1–3 are additive and safe to leave.
6. Every implementation PR: `/code-review ultra` (payments), full test suite, manual smoke of
   checkout→webhook→transfer in Stripe test mode.

## Open Questions

1. **Holding-window ceiling** (compliance table row 2) — needs a docs/support answer before real
   users; does not block implementation.
2. **DAC7 registration** — advisor question; the ledger provides the data regardless.
3. Should the pending-balance card also render for `active` photographers with a residual sub-50¢
   balance? (Proposed: yes, same component, different copy — decide at PR 4 with the UI in hand.)
