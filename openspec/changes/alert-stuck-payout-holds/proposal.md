# T-254 · Alert when a payout hold is stuck beyond its window

## Why

T-249 (PR #306) wired `reportMoneyIncident` into the Stripe webhook, and its alerts tell the
operator that unpaid debt will sit in `payouts` for `retry-pending-payouts` to drain. But that
worker's own failure exits are still console-only (`retry-pending-payouts.ts:315,335,378,733,771,842`):
a `transfer_failed` hold whose `createTransfer` always fails (invalid destination, revoked
capability) is retried every 30 minutes **forever** with no Sentry event, no email and no counter —
the exact "money didn't move and nobody knows" state the new alerts point at. Found by
`/code-review xhigh` on PR #306.

## What Changes

- A new recovery-sweep step in `retry-pending-payouts` reports payout rows stuck beyond their
  window, following the `report-unconfirmed-reversals` reference shape (T-264): one aggregated
  incident for the whole set, claimed at most once per rolling day via the Postgres-backed
  `rateLimit`, ids and amounts only (no buyer PII).
- Two windows, one incident kind:
  - **≥ 24 h** for rows the worker itself is failing to drain: `pending` + `transfer_failed`
    (≈ 48 failed attempts), and any `processing` row (wedged in the recovery loops — perpetual
    inconclusive probe, re-drive that always fails, or no Connect destination).
  - **≥ 30 days** for recorded debt waiting on an external condition: `pending` +
    `connect_inactive` / `below_minimum`. Legitimate states short-term (T-250 already emails the
    photographer; sub-minimum accumulates by design), but at 30 days they are money nothing will
    move.
- New `MoneyIncidentKind` `'payout-hold-stuck'` — its OWN kind per T-264 ("binding on T-254"),
  **not** the `needs-reconciliation` the ticket's DoD mentions: fingerprint and email throttle are
  keyed per kind, so sharing would collapse distinct problems and let the first firing silence the
  rest. `needs-reconciliation` stays reserved for the clawback path.
- The clock is `created_at`, not `updated_at`: the `payouts_set_updated_at` trigger re-stamps
  `updated_at` on every failed retry, so only `created_at` measures how long the debt has been
  outstanding. Rows carrying `frozen_by_dispute_id` are always excluded — T-265's
  `dispute-freeze-stuck` already owns those.
- The sweep **reports and never repairs** (same line T-255/T-265 draw), and the alert never
  instructs a manual transfer — the ledger stays the authority (T-249 rule).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `photographer-payout-ledger`: adds the requirement that a hold outstanding beyond its window is
  reported through the money-incident channel — aggregated, at most once per rolling day, without
  changing what the worker pays or when.

## Impact

- `src/database/queries/payouts.ts`: two new read-only selectors (`listStuckRetryableRows`,
  `listAgedOutstandingHolds`).
- `src/lib/observability/report-money-incident.ts`: new kind `'payout-hold-stuck'`.
- `src/lib/inngest/functions/retry-pending-payouts.ts`: new `report-stuck-holds` step placed
  BEFORE `resolve-payable-holds` (the flow early-returns when nothing is payable — exactly the
  revoked-capability scenario the alert exists for) and two new `RetryPayoutsResult` counters.
- `test/integration/inngest/retry-pending-payouts.test.ts`: regression coverage.
- `CLAUDE.md` money-path section + `backlog/DECISIONS.md` §5.
- No path that moves money changes; no migration; rollback is inert (revert the code).
