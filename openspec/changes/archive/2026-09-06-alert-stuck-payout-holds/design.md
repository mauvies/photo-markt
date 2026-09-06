# Design — alert-stuck-payout-holds (T-254)

Transcription of the plan approved in-session (2026-09-06). Motivation in `proposal.md`.

## Context

`retry-pending-payouts` (`src/lib/inngest/functions/retry-pending-payouts.ts`) drains the `payouts`
holds the webhook could not send. Its failure exits are `console.warn`/`console.error` only: the
transfer catch at :771, the batch re-drive catch at :335, the batch transfer catch at :842, and the
inconclusive-probe skips at :315/:378/:733. A row those exits keep bouncing forever never produces a
Sentry event or an ops email. The cron runs 48×/day (`10,40 * * * *`).

Since the ticket was filed, T-255/T-264/T-265 fixed the house rules for exactly this kind of change:
own `MoneyIncidentKind` per sweep, alert about a STATE (aggregated, claimed once per rolling day via
the Postgres-backed `rateLimit`, which fails open), report-never-repair, never instruct a manual
transfer. `report-unconfirmed-reversals` (same file, :406) is the reference shape.

## Goals / Non-Goals

**Goals:**
- A hold the worker has been failing to drain for ≥ 24 h raises `reportMoneyIncident`.
- Recorded debt outstanding ≥ 30 days on an external condition (`connect_inactive`,
  `below_minimum`) becomes visible too — CLAUDE.md assigns that visibility to T-254.
- At most one aggregated alert per rolling day; ids and amounts only.

**Non-Goals:**
- No repair, no re-drive, no status change — the step is read-only plus the alert.
- No change to any paying step, selector or claim; no migration; no per-attempt alert.
- Frozen rows (`frozen_by_dispute_id`) stay T-265's problem (`dispute-freeze-stuck`).

## Decisions

1. **Own kind `'payout-hold-stuck'`, not `needs-reconciliation`.** The ticket's DoD predates T-264,
   which is explicitly binding on T-254: Sentry fingerprint and email throttle are keyed per kind,
   so a shared kind collapses distinct problems and the first firing silences the rest.
   One sweep = one kind; context fields distinguish the tiers.

2. **The clock is `created_at`.** The `payouts_set_updated_at` trigger
   (`20250218000000_create_payouts.sql`) re-stamps `updated_at` on every UPDATE, and a
   `transfer_failed` row is re-held (`holdPayoutRow`) on every failed tick — `updated_at` therefore
   measures the last attempt, `created_at` measures how long the debt has been unpaid.

3. **Two windows, four shapes:**
   - `STUCK_HOLD_AGE_MS = 24 h` (≈ 48 attempts): `pending`+`transfer_failed`, and ANY `processing`
     row. `processing` covers the wedges the recovery steps cannot exit: perpetual `unknown` probe,
     batch re-drive that always throws, and a photographer with no Connect destination (steps 0/0b
     `continue` silently without one).
   - `OUTSTANDING_HOLD_AGE_MS = 30 d`: `pending`+`connect_inactive`/`below_minimum`. Legitimate
     short-term (T-250 already emails the photographer; sub-minimum accumulates by design) — hence
     no 24 h alert — but at 30 days they are recorded money nothing will move.

4. **No `stripe_charge_id` filter on the stuck selector.** `listPayableHolds` requires a charge id
   as a security filter, so a `hold_reason` row without one is *more* stuck (structurally
   unpayable), not less. Legacy pre-T-216 rows have no `hold_reason` and stay excluded.

5. **Step placement: after `release-stale-dispute-freezes`, BEFORE `resolve-payable-holds`.** The
   flow early-returns when `payableRows` is empty — which is exactly what a revoked capability
   produces (account no longer active ⇒ holds filtered out ⇒ empty ⇒ return). Reporting after the
   paying steps would never run in the very scenario the ticket names.

6. **Reference shape throughout:** list → empty ⇒ return without touching the limiter → `rateLimit(
   'money-alert:payout-hold-stuck', limit 1, 24 h)` → one aggregated `reportMoneyIncident`. List
   errors are caught and logged (recovery/reporting must not gate the money — same guard as the
   freeze sweep). Counters returned by the step and assigned OUTSIDE it (Inngest replay memoizes
   step bodies).

## Risks / Trade-offs

- [One kind for both tiers ⇒ a tier-2 firing can silence a new tier-1 row for up to 24 h] → accepted:
  the tier-1 row has already been broken 24 h, the alert aggregates both sets when both exist, and
  the precedent (`dispute-freeze-stuck`) aggregates multiple sub-cases the same way.
- [A row stuck 24 h that would have been paid this very pass gets counted once] → self-corrects next
  pass; the alert is daily and aggregated, so no flood.
- [Daily alert forever for a never-onboarding photographer] → intentional: unclaimed 30-day-old
  liability is a state an operator must eventually act on, and one email/day is the agreed cost
  (same posture as `dispute-freeze-stuck`).

## Migration Plan

None. Read-only selectors + one new union member + one new step. Rollback = revert the code.

## Open Questions

None — all decisions above were approved in the session plan.
