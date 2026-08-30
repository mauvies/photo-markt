## Context

Three places decide the behaviour, and the current lines are:

- `src/app/api/stripe/webhook/route.ts:1757` — `freezeHoldsForCharge` throws → `console.error`.
- `src/app/api/stripe/webhook/route.ts:1866` — `restoreHoldsForCharge` throws → `console.error`.
- `src/database/queries/payouts.ts:300` — `listPayableHolds` excludes every row whose
  `frozen_by_dispute_id` is set. That exclusion is correct — it is what a freeze *is* — and it is also
  what makes the first failure terminal.

`restoreHoldsForCharge` is the only writer that clears the mark, and it runs only from the
`charge.dispute.closed` branch. There is no second driver, no cron and no selector that would ever
look at such a row again.

Existing material this change reuses rather than reinvents:

- `reportMoneyIncident` (`src/lib/observability/report-money-incident.ts`) — never throws, carries no
  buyer PII, Sentry fingerprint `['money-incident', kind]`, per-kind email throttle.
- `isDisputeOpen` / `isDisputeClosed` (`src/lib/payouts/clawback.ts`) — the dispute-status vocabulary,
  already enumerated against the installed SDK and already tested.
- `isStripeResourceMissing` (`src/lib/stripe/resource-missing.ts`) — tells "stale reference" from
  "Stripe is having a bad minute".
- `report-unconfirmed-reversals` in `retry-pending-payouts.ts` — the reference shape for a sweep: one
  aggregated incident, claimed once per rolling day through the Postgres-backed `rateLimit`.
- `payouts_set_updated_at` trigger and the partial index `payouts_frozen_by_dispute_idx` — the
  staleness clock and the index the sweep's selector needs, both already in the schema.

## Goals / Non-Goals

**Goals:**

- Make both failures visible, with no change whatsoever to what the handler does.
- Give the stranded-money case (a failed unfreeze) an automatic way out that cannot pay a charge that
  is still disputed.
- Keep the alert volume at one aggregated message per day for a state that does not fix itself.

**Non-Goals:**

- Changing the `lost` branch, the clawback maths, or any other part of the money flow.
- Adding a column, a migration, or a fourth cron slot.
- Recovering a failed *freeze* automatically. Nothing local can distinguish "we failed to freeze it"
  from "it was never frozen", and the honest retry already exists: a later `charge.dispute.updated`
  re-runs the same idempotent body.

## Decisions

### The sweep asks Stripe, and repairs only the unambiguous case

The alternative — a purely local sweep, mirroring T-264's "report, do not repair" — cannot work here,
and the reason is a property of the data rather than a preference:

1. A **lost** dispute leaves the row `cancelled` + `void_reason='dispute'` + `frozen_by_dispute_id`
   **forever**; the `lost` branch never calls `restoreHoldsForCharge`. That is byte-for-byte the same
   local state as "won, but the unfreeze failed". A local sweep would therefore alert on every lost
   chargeback, every day, forever — and the real stuck rows would be buried in that noise.
2. A chargeback legitimately stays open for 60–90 days, so an age-based local sweep would have to
   wait ~90 days before it could call anything stale. Asking Stripe makes "still open" a definitive
   non-alert, so the staleness window can be hours.

T-264's reasoning does not transfer because the question is different in kind. There it was "does this
transfer exist?", answered by a listing whose `has_more` makes `unknown` unavoidable. Here it is
`disputes.retrieve(dp_x)` — a lookup by id, where a failure to read is distinguishable from an answer.

The repair itself moves no money at Stripe: `restoreHoldsForCharge` clears a mark, is idempotent, and
is scoped to one dispute id. What it does is return the row to the ordinary payout path, which keeps
every guard it already had (the row id as idempotency key, `source_transaction`, the partial unique
index on `(stripe_charge_id, photographer_id)`).

**Alternative considered and rejected:** having the `lost` branch clear the freeze mark, which would
make a local-only sweep unambiguous. It changes the webhook's money flow — precisely what the ticket
says not to do — it needs a new rule for what to do when the clawback itself failed (clearing the mark
there would make a lost dispute payable), and it still leaves the 90-day problem in (2).

### Three incident kinds, not one

The Sentry fingerprint and the email throttle are both keyed on `kind`. Sharing one kind across a
failed freeze, a failed unfreeze and the sweep would collapse three distinct problems into a single
Sentry issue and let whichever fires first silence the others for the window — the rule established in
T-264. `needs-reconciliation` stays reserved for the clawback path that already declares it.

### A step in the existing worker, not a new cron

`retry-pending-payouts` already owns payout recovery and already hosts a sweep of exactly this shape.
A new Inngest function would need a fourth cron slot (the three existing ones are deliberately offset)
and would be a second registration competing for the same rows.

The step is placed after `report-unconfirmed-reversals` and **before** `resolve-payable-holds`, so a
row released this pass is paid in the same pass rather than 30 minutes later.

### One Stripe read per dispute, not per row

Stale rows are grouped by `(frozen_by_dispute_id, stripe_charge_id)`. With zero stale rows — the
normal state — the step makes zero Stripe calls, which is what keeps it free to run on the worker's
event trigger (`payouts.retry-requested`) as well as its cron.

### A successful release logs; it does not alert

If the webhook's unfreeze failed, that already alerted (`dispute-unfreeze-failed`); alerting again
when the sweep fixes it would duplicate the incident. The release count is returned in the run result,
where Inngest records it.

## Risks / Trade-offs

- **A repaired row is paid without a fresh alert** → the failure that stranded it already alerted, and
  the release is logged and counted in the run result.
- **If `charge.dispute.closed` never arrives at all** (the T-192 shape: the production endpoint on a
  host that 307-redirected, so every delivery died), the sweep repairs the freeze silently and nobody
  learns that dispute events are being dropped → accepted for now, and called out here: the run
  result carries the count, and T-256 is the ticket about deployment/repo drift detection.
- **A Stripe read failure during the sweep** → treated as `unknown`: nothing is released, the row is
  reported. Never a conclusion.
- **A dispute id Stripe 404s** (wiped test data is a real occurrence in this project) → reported, not
  released.
- **The staleness window is a guess** → 6 hours is far above any Stripe redelivery interval and far
  below a dispute's lifetime; a row inside the window is untouched and unread.

## Migration Plan

No schema change, so nothing to migrate and nothing to roll back in the database. Reverting the commit
restores the previous behaviour exactly: the two `catch` blocks return to logging, and the sweep step
disappears without leaving state behind (it writes only through `restoreHoldsForCharge`, which is the
webhook's own operation).

## Open Questions

None. The one open decision named in the ticket — whether the sweep consults Stripe or only reports —
was decided before implementation and is recorded above.
