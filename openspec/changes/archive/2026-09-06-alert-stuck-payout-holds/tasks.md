# Tasks — alert-stuck-payout-holds (T-254)

## 1. Selectors and incident kind

- [x] 1.1 Add `listStuckRetryableRows(supabase, createdBeforeIso, limit)` to
      `src/database/queries/payouts.ts`: `(pending + transfer_failed) OR processing`,
      `frozen_by_dispute_id IS NULL`, `created_at < cutoff`, `created_at ASC`, limit. Docstring:
      why `created_at`, why no charge-id filter, why frozen rows are excluded.
- [x] 1.2 Add `listAgedOutstandingHolds(supabase, createdBeforeIso, limit)`: `pending` +
      `hold_reason IN (connect_inactive, below_minimum)`, same frozen/cutoff/order/limit shape.
- [x] 1.3 Add `'payout-hold-stuck'` to `MoneyIncidentKind` in
      `src/lib/observability/report-money-incident.ts` with a doc comment in the T-264/T-265 style;
      update the producers comment ("the two sweep kinds" → three).

## 2. Worker step

- [x] 2.1 Add constants `STUCK_HOLD_AGE_MS` (24 h), `OUTSTANDING_HOLD_AGE_MS` (30 d),
      `STUCK_HOLD_ALERT_WINDOW_SEC` (24 h) to `retry-pending-payouts.ts`.
- [x] 2.2 Add step `report-stuck-holds` after `release-stale-dispute-freezes` and BEFORE
      `resolve-payable-holds` (the early return): both list calls in try/catch → log + zeros;
      empty set ⇒ return without touching the limiter; else `rateLimit('money-alert:payout-hold-stuck',
      limit 1, 24 h)`; on claim, one aggregated `reportMoneyIncident` — context `stuckRowCount`,
      `agedRowCount`, `totalPayableCents` (sum of `payableCents`), `oldestPayoutId`,
      `oldestCreatedAt`, `oldestStatus`, `oldestHoldReason`, `payoutIds` (cap 20, oldest first);
      message names the state, no manual-transfer instruction.
- [x] 2.3 Add `holdsStuck` / `holdsLongOutstanding` to `RetryPayoutsResult`; step returns the
      counts, assignment happens OUTSIDE the step body (replay rule).

## 3. Regression tests (`test/integration/inngest/retry-pending-payouts.test.ts`)

- [x] 3.1 Core regression: active account, `transfer_failed` hold, `createTransfer` always throws,
      `nowMs = +25 h` ⇒ `reportMoneyIncident` called with `kind: 'payout-hold-stuck'` and the row id
      in `payoutIds`; row still `pending`. (Fails on main: the kind does not exist.)
- [x] 3.2 No per-attempt alert: same seed at `nowMs = +1 h` ⇒ kind not reported.
- [x] 3.3 `connect_inactive` at +25 h ⇒ not reported; at +31 d ⇒ reported (tier 2). A frozen row
      (`frozen_by_dispute_id`) never appears at any age.
- [x] 3.4 Once per rolling day: two consecutive runs ⇒ exactly one report of the kind.
- [x] 3.5 Stale `processing` single (no batch, probe `unknown`) at `nowMs = +25 h` ⇒ reported.

## 4. Docs and gates

- [x] 4.1 Update CLAUDE.md money-path bullet «Not every hold self-heals … (visibility = T-254)» to
      describe the new sweep; add the kind to the sweeps section.
- [x] 4.2 Add a brief T-254 entry to `backlog/DECISIONS.md` §5 (two windows, `created_at` clock).
- [x] 4.3 `pnpm typecheck && pnpm lint && pnpm test` green (integration via local Supabase).
- [x] 4.4 Money-path review per /work-next step 6: 3 refutation subagents (no-pay / double-pay /
      silent-failure) ran on the diff before committing. No-pay and double-pay returned "ninguno";
      silent-failure found two real gaps, both fixed here (the sweep's own failure was
      console-only despite the step succeeding → `payout-hold-sweep-failed`; the 500-row cap
      truncated silently → `limit + 1` and `countsTruncatedAtRows`). `/code-review high` then ran
      on the branch and returned five findings, all four real ones fixed in a follow-up commit:
      the sweep moved after the transfers (it was reporting rows the same pass paid), per-read
      error guards, per-currency amounts, and a jsdoc correction; the fifth (the sweep-failed
      daily claim degrading during a total database outage) is documented as best-effort rather
      than changed, since failing open beats silence about a broken watchdog.
