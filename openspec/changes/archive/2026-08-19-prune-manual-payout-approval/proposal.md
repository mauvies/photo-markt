## Why

The product carries a complete manual payout-approval surface — `/api/admin/payouts/[id]` — for a
flow that cannot happen. T-216 answered the question this endpoint was waiting for: `pending` now
means "a hold the retry worker will drain automatically", not "a request awaiting a human". The
endpoint is already inert for every row the system will ever create (it refuses anything carrying a
`stripe_charge_id`, and the ledger's only writer always sets one), so what remains is an admin
mutation surface whose one capability is to move the ledger **without moving money** — flipping a
row to `paid` creates no Stripe transfer. In a system where the `payouts` rows are the authority an
operator reconciles against (T-249), that is a liability rather than a feature.

## What Changes

- **BREAKING (operator-facing, not user-facing):** remove the `POST /api/admin/payouts/[id]`
  endpoint. This empties `src/app/api/admin/`, leaving the app with no admin route handlers.
- Remove `updatePayoutStatus` (the endpoint was its only caller) and `createPayout` (no caller in
  `src/`; it writes the exact shape the T-216 migration quarantined — `pending`, no charge id, no
  hold reason — and is the last writer of the legacy `payment_accounts.id`).
- Add a source-level guard test so the route cannot silently return, mirroring the existing
  dead-billing-routes guard from T-202.
- Nothing about the ledger changes: `pending`, `approved`, the hold reasons, the retry worker and
  the `payouts` RLS policies are untouched, and there is **no migration**.
- Correct the documentation that still describes the admin flow as pending a decision
  (`ARCHITECTURE.md` §4.3, three references in `CLAUDE.md`).

Two of the three items the originating ticket proposed removing are already gone or must stay: the
"photographers can cancel their own pending payouts" RLS policy was dropped by migration
`20260807000000`, and the `pending` status is now load-bearing for the ledger.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `photographer-payout-ledger`: the requirement *"An in-flight payout cannot be altered out of
  band"* currently describes an administrative endpoint that refuses ledger-tracked rows. It
  strengthens: no out-of-band mutation surface exists at all, so the guarantee no longer depends on
  that endpoint's refusal logic being correct.

## Impact

- **Removed:** `src/app/api/admin/payouts/[id]/route.ts` (and the now-empty `src/app/api/admin/`
  tree); `updatePayoutStatus` and `createPayout` in `src/database/queries/payouts.ts`.
- **Unchanged and deliberately kept:** `getPayouts` (live — the Earnings tab), `getPayout`,
  `createPayoutFromTransfer` (documented T-216 idempotency semantics, not part of the manual
  approval story), the `payouts` schema and RLS, the retry worker.
- **`admin_users` keeps a consumer:** the admin status page
  (`src/app/[lang]/dashboard/admin/status/page.tsx`) uses the same service-role lookup, so the gate
  pattern hardened by the May 2026 security audit stays exercised in `src/`.
- **Tests:** new guard test; `test/integration/queries/payouts.test.ts` reseeds its fixtures with
  direct service-role inserts instead of the deleted helpers; `payouts-rls.test.ts` untouched.
- **Operators:** no capability is lost in practice. The endpoint's only reachable targets were
  pre-T-216 rows with a null charge id, and **production has none** — T-236 was closed in August 2026
  with nothing to sweep. Should one ever appear, direct DB access is the escape hatch, the same tool
  the project already prescribes for seeding admins.
- **Note for T-219:** `createPayout` was the last writer of the `payouts.payment_account_id` column
  (a FK into the legacy `payment_accounts` table), so removing it drops one reference T-219 would
  have had to unpick. It does **not** clear the way on its own — `payment-accounts.ts` still exports
  four writers and is still re-exported from the queries index, and the FK itself remains. ⚠️ Two of
  T-219's own findings now point at nothing: its row about `payouts.ts:85-92` "still accepting
  `paymentAccountId`" now lands inside `getPayout`, and its criterion "`createPayout` stops accepting
  `paymentAccountId`" is unsatisfiable because the function is gone.
