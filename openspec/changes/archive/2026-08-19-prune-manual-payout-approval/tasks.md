## 1. Guard first (so the deletion is a proven regression)

- [x] 1.1 Add `test/unit/api/dead-admin-payout-route-removed.test.ts`, modelled on
      `test/unit/api/dead-billing-routes-removed.test.ts`: assert no `route.(ts|tsx|js|jsx)` exists
      anywhere under `src/app/api/admin/`
- [x] 1.2 In the same file, mirror the precedent's second test — assert the live ledger surface
      still exists (`openPayoutRow` and `settlePayoutPaid` exported from
      `src/database/queries/payouts.ts`, and the `retry-pending-payouts` worker file), so the
      deletion cannot later be widened into the flow that replaced it
- [x] 1.3 Run the new test and confirm it FAILS against the current tree (the route file is present)

## 2. Delete the surface

- [x] 2.1 Delete `src/app/api/admin/payouts/[id]/route.ts` and the now-empty directories up to
      `src/app/api/admin/`
- [x] 2.2 Delete `updatePayoutStatus` from `src/database/queries/payouts.ts` (the route was its only
      caller)
- [x] 2.3 Delete `createPayout` from `src/database/queries/payouts.ts` (no caller in `src/`; writes
      the quarantined `pending`/no-charge-id/no-hold-reason shape and is the last writer of
      `payment_accounts.id`)
- [x] 2.4 Confirm `getPayouts`, `getPayout`, `createPayoutFromTransfer`, `openPayoutRow`,
      `settlePayoutPaid`, `holdPayoutRow` and the batching helpers are all still exported and
      unchanged
- [x] 2.5 Grep for stragglers: `updatePayoutStatus`, `createPayout(`, `api/admin/payouts` — expect
      hits only in the two dated audit files under `docs/`

## 3. Repair the tests the deletion touches

- [x] 3.1 Rewrite `test/integration/queries/payouts.test.ts`: drop the describes that only exercised
      `createPayout` and `updatePayoutStatus`; keep `getPayout`, `getPayouts` and the totals-helper
      coverage by seeding rows with direct service-role inserts (which also removes the
      `payment_accounts` seeding those fixtures needed)
- [x] 3.2 Update the header comment of `test/integration/security/admin-users.test.ts` so it no
      longer narrates a live route — note the audit finding as history and that the gate pattern now
      lives in `src/app/[lang]/dashboard/admin/status/page.tsx`. Leave the assertions alone
- [x] 3.3 Confirm `test/integration/security/payouts-rls.test.ts` still passes untouched

## 4. Documentation

- [x] 4.1 `ARCHITECTURE.md` §4.3 — replace the sentence deferring the endpoint's fate to T-220 with
      the decision and its reason (ledger rows are service-role-only; a status flip is not a
      transfer)
- [x] 4.2 `CLAUDE.md` — remove the Server-Actions rule's `api/admin/payouts/[id]` exception (no
      `/api/admin/*` route remains), update the payouts bullet ending "its future is T-220", and fix
      the `admin_users` line that says it is used by `/api/admin/*` endpoints
- [x] 4.3 Leave `docs/CACHING_AUDIT.md` and `docs/AI_REKOGNITION_PRE_AUDIT.md` untouched — dated
      audit records

## 5. Verify

- [x] 5.1 Confirm the new guard test now PASSES
- [x] 5.2 `pnpm typecheck && pnpm lint && pnpm test` green (local Supabase up for integration)
- [x] 5.3 `pnpm build` — the change touches `src/database/queries/`
- [x] 5.4 `/code-review ultra` on the diff (ticket is `Riesgo: alto`, payments) and fix real findings

## 6. Review follow-ups (`/code-review max`)

- [x] 6.1 Strengthen the guard: assert the CAPABILITY (no `from('payouts')` outside the query layer)
      rather than only the route path — the flow would realistically return as a Server Action.
      Verified by planting a violating file and watching it fail
- [x] 6.2 Assert `retryPendingPayouts` is registered on the Inngest route, not merely that its file
      exists (this repo has a recorded prod incident of unregistered functions with dead crons)
- [x] 6.3 Assert the admin status page's `if (!admin)` deny line, not just its `admin_users` query
- [x] 6.4 Correct three documentation overclaims: the Stripe webhook and Inngest route are NOT
      "non-mutation surfaces"; holds do NOT all drain automatically (stranded `processing`, lone
      sub-50¢ → T-254); production has NO pre-T-216 legacy rows (T-236 closed with nothing to sweep)
- [x] 6.5 Name `voidHoldsForCharge` as the third payout writer everywhere the change claimed two —
      it cancels holds, which is the operation the new requirement forbids elsewhere
- [x] 6.6 Fix the stale references the straggler grep's expectation missed: `scripts/advisors-baseline.ts`
      (live CI gate), `README.md`, three more `CLAUDE.md` spots, `ARCHITECTURE.md` §2
- [x] 6.7 Correct the proposal's wrong "unblocks T-219" claim and flag T-219's two now-unsatisfiable
      findings
- [x] 6.8 Add `20260808000000_correct_admin_users_comment.sql` — metadata-only, because the live DB
      comment still advertises the deleted endpoints and an applied migration never re-runs
- [x] 6.9 Record the PR #290 (T-215) collision in the backlog's anti-conflict section
