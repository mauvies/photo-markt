## Context

T-220 was written when `pending` payout rows had no producer: transfers were logged directly as
`paid`, so the admin endpoint, the self-cancel RLS policy and the `pending` status looked like
infrastructure for a flow that could not happen. The ticket therefore framed the decision as
"revive it or prune it", and predicted that reviving was the natural answer because the then-planned
T-216 would *need* `pending` rows.

T-216 has since shipped, and it settled the question differently than predicted:

- `pending` is now the hold state (`connect_inactive` / `below_minimum` / `transfer_failed`), drained
  automatically by the `retry-pending-payouts` worker. It is load-bearing — removing it would
  destroy the ledger.
- Migration `20260807000000` already dropped both the self-INSERT policy and the
  "photographers can cancel their own pending payouts" policy, for the reason this change repeats:
  once a worker really sends `pending` money, a self-written row is theft and a user-cancelled hold
  is unpayable forever.
- The admin endpoint gained a stopgap guard: it 409s on any row that is `processing` or carries a
  `stripe_charge_id`, explicitly deferring its own fate to this change.

So only the endpoint is left to decide, and T-216 gave `pending` its meaning without it.

## Goals / Non-Goals

**Goals:**

- Remove the administrative payout mutation surface and the query helpers that exist only to serve
  it.
- Make the removal durable — a guard test, not just an absent file.
- Leave the documentation describing what is true, rather than describing a decision as pending.

**Non-Goals:**

- Any change to the ledger: statuses, hold reasons, indexes, RLS, the retry worker, the webhook.
  **No migration is part of this change.**
- Removing the `approved` status. Nothing writes it any more, but `getTotalPendingPayouts` reads it
  defensively so a legacy `approved` row still counts as unlanded money. Dropping it needs a
  migration and belongs with the dead-schema pruning of T-219.
- Removing `payment_accounts`, `ai_search_profiles` or other dead schema — that is T-219.
- Building any replacement admin visibility. Alerting on a hold that never drains is T-254.

## Decisions

**Delete the endpoint rather than build a UI for it.**
Three reasons, in order of weight. (1) A status change is not a transfer — `updatePayoutStatus`
writes a column and calls no Stripe API, so the endpoint's headline capability is making the ledger
claim a payment that never happened, and T-249 established the ledger as the authority an operator
reconciles against. (2) It is already inert: it refuses every row with a `stripe_charge_id`, and
`openPayoutRow` requires one, so nothing created from T-216 onward is reachable. (3) The actions an
admin UI would expose are automated or harmful — holds drain on their own, `charge.refunded` voids
holds, and cancelling a hold makes it permanently unpayable because
`payouts_charge_photographer_key` blocks a replacement row.

*Alternative considered — revive it (the ticket's option (a)):* give the route a UI, an
authorization test and keep its rate limit. Rejected: it buys no capability that is not automated,
and its one distinctive power is the dangerous one.

**Leave the legacy rows to direct DB access.**
The endpoint's only reachable targets are pre-T-216 rows, which the same migration stamped
*"predates the payout ledger; not payable by the retry worker."* They are inert by construction. If
one ever needs correcting, the Supabase SQL editor is the right tool — the project already
prescribes exactly that for seeding admins, and an audited one-off beats a permanently live endpoint.

**Delete `createPayout` alongside `updatePayoutStatus`.**
`updatePayoutStatus` is orphaned by the route. `createPayout` is separately dead (no caller in
`src/`, as the T-216 migration comment records) and actively hazardous to keep available: it writes
`pending` with no charge id and no hold reason — precisely the shape T-216 had to quarantine — and
it is the last writer of `payment_accounts.id`, so removing it clears a dependency out of T-219's
path.

**Keep `createPayoutFromTransfer` and `getPayout`.**
Both are callerless, but neither is part of the manual-approval story: `createPayoutFromTransfer`
carries documented T-216 idempotency semantics and its own tests, and `getPayout` is a
photographer-scoped read. Deleting them would widen a payments change for tidiness. Recorded here so
a reviewer reads it as a decision, not an oversight.

**Guard the deletion at the source level.**
`test/unit/api/dead-billing-routes-removed.test.ts` (T-202) already established the pattern and its
reasoning: a `fetch` proves nothing in a unit run, and what must not come back is the *file*, since
Next's app-router file convention is what makes the endpoint exist. The new test mirrors it,
including its second half — asserting the live replacement surface still exists, so the deletion
cannot later be widened into the flow that superseded it.

## Risks / Trade-offs

- **An operator loses a manual lever** → It never worked on ledger rows, and the lever it did offer
  (mark `paid` without transferring) is the one that corrupts reconciliation. Direct DB access
  remains for the inert legacy rows.
- **`admin_users` could look orphaned and be pruned next** → It is not: the admin status page
  (`src/app/[lang]/dashboard/admin/status/page.tsx`) uses the same service-role lookup. The guard
  test and the CLAUDE.md edit both point at that page so the gate pattern keeps an owner in `src/`.
- **The rate-limit call shape documented in two audit files becomes a dangling reference** →
  Accepted. Those are dated audit records; editing them would falsify what was true when written.
  `src/lib/rate-limit.ts` remains the real reference, with live call sites elsewhere.
- **`src/app/api/admin/` becoming empty could read as "admin routes are forbidden"** → The
  CLAUDE.md edit states the actual rule: mutations go through Server Actions, and there is now no
  admin route exception.

## Migration Plan

No database migration and no data change. Deployment is a code deletion; rollback is a revert. No
in-flight state depends on the endpoint, since it refused every ledger-managed row already.

## Open Questions

None. The one product decision — prune versus revive — was taken before this document was written.
