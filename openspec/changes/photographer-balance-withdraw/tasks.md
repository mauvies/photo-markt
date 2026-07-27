# Tasks — photographer-balance-withdraw

> Gate: T-190's DoD requires the user's explicit OK on `design.md` BEFORE starting any task below.
> Each numbered group = one child backlog ticket = one branch/PR (draft), in this order.
> Every PR here touches payments → `/code-review ultra` before merge; prod migration applied
> manually via MCP while `migrate.yml` is billing-blocked.

## 1. Ledger schema + query layer (child ticket A — PR 1)

- [ ] 1.1 Migration `create_ledger_entries`: table per design D1 (signed `amount_cents`, `type` check,
      unique `idempotency_key`, provenance columns, index on `photographer_id`); RLS enabled,
      owner-select-only policy, no write policies for anon/authenticated
- [ ] 1.2 `src/database/queries/ledger.ts`: `insertLedgerEntry` (`on conflict do nothing`, returns
      whether inserted), `getLedgerBalance(photographerId)`, `getPendingBalances(minCents)` (for
      reconciliation), `getLedgerEntriesForPhotographer` (earnings UI)
- [ ] 1.3 Integration tests: balance = SUM; duplicate idempotency key is a no-op; RLS — user client
      cannot insert, photographer selects only own rows (security suite pattern)
- [ ] 1.4 Apply migration to prod manually via MCP after merge; align migration tracking row

## 2. Webhook credits + refund netting (child ticket B — PR 2)

- [ ] 2.1 `createTransfersForOrderItems`: active path — after successful transfer, write matched
      `sale_credit`/`withdrawal` pair; non-active path — replace warn-and-drop with `sale_credit`;
      sub-50¢ net — credit instead of skip (all idempotent per D1 keys)
- [ ] 2.2 `charge.refunded` handler: per-photographer `refund_debit` for un-withdrawn credits only;
      proportional partial refunds rounding in the photographer's favor (design D4)
- [ ] 2.3 Regression tests (webhook integration suite): active sale journals net-zero pair; non-active
      sale credits balance; redelivered event does not double-credit; sub-minimum accumulates; full
      and partial refund netting; refund-after-withdrawal untouched
- [ ] 2.4 Update `ARCHITECTURE.md §4.3` (money path now journaled; non-active = credit not drop)

## 3. Withdrawal on activation + reconciliation (child ticket C — PR 3)

- [ ] 3.1 `account.updated` handler: on transition to `active`, sweep balance ≥ 50¢ via
      `transfers.create` (no `source_transaction`), write `withdrawal` entry + `payouts` row;
      failure leaves balance intact (design D3)
- [ ] 3.2 Inngest cron `reconcile-ledger` (sibling of `reconcile-indexing`): self-consistency check,
      stranded-balance re-drive, platform-balance drift alert via Resend (`LEDGER_ALERT_EMAIL` in
      `env.mjs`, absent ⇒ no-op)
- [ ] 3.3 Integration tests: activation sweeps and is idempotent; failed transfer leaves balance;
      re-drive picks up a missed activation; drift alert fires/no-ops per env
- [ ] 3.4 Register the cron in `/api/inngest` route; verify prod Inngest sync post-deploy (known
      drift gotcha)

## 4. Backfill + unblock checkout + pending-balance UI (child ticket D — PR 4)

- [ ] 4.1 One-shot backfill (design D7): reconstruct `sale_credit` entries for completed order items
      with no covering `payouts` row; review output by hand before running against prod via MCP
- [ ] 4.2 Remove the `photographerNotConnected` gate from BOTH checkout actions (guest
      `cart/actions.ts` + authenticated) and delete the now-unused dict keys (en + es)
- [ ] 4.3 Earnings tab: pending-balance card (new `ledger.ts` read), copy for "accumulating until you
      connect payouts", strings in `en.json` + `es.json`
- [ ] 4.4 Regression tests: checkout succeeds with a non-connected photographer in the cart (both
      paths — the inverse of today's gate tests); pending balance renders
- [ ] 4.5 Update `CLAUDE.md` (payments section: ledger model, no checkout gate) and re-evaluate
      T-189 in the backlog (supersede scope; keep only what still applies)
- [ ] 4.6 Manual smoke in Stripe test mode: sale to non-connected photographer → balance accrues →
      complete onboarding → withdrawal lands in the connected account
