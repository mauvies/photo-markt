## Context

`createTransfersForOrderItems` (`src/app/api/stripe/webhook/route.ts:101-183`) runs on
`payment_intent.succeeded` for authenticated orders and inside `checkout.session.completed` for guest
orders. Per photographer it reconciles the Connect status, computes the net via `getPhotographerNetCents`
(`src/lib/plans.ts:114`), transfers, and calls `createPayoutFromTransfer` to log a `payouts` row already
in `status='paid'`.

Three exits skip the transfer with only a log line, and none of them leaves a trace:

| Exit | Line | Today |
|---|---|---|
| Connect not `active` after the live reconcile | `:146-151` | `console.warn` + `continue` |
| `netCents < 50` (Stripe's transfer minimum) | `:155-160` | `console.warn` + `continue` |
| `createTransfer` throws | `:179-181` | `console.error`, loop continues |

The `payouts` table (`supabase/migrations/20250218000000_create_payouts.sql`, extended by
`20260501000000_add_stripe_connect.sql`) predates the automatic Connect model — its header still says
"Manual payout system (Option A)". It has `status text check in ('pending','approved','paid','cancelled')`
and `stripe_transfer_id TEXT UNIQUE`, but **no charge id, no currency, no order reference**, and nothing
inserts a `pending` row: every payout is written straight to `paid`. That is why `/api/admin/payouts/[id]`
has nothing to approve (T-220).

Constraints that shape the design:
- Idempotency today rests entirely on Stripe's key `transfer_<charge>_<photographer>`, whose dedup window
  is **24 hours**. Stripe retries a failing webhook for up to **3 days**, and an operator can resend by
  hand at any time.
- `createPayoutFromTransfer` (`src/database/queries/payouts.ts:136`) swallows Postgres `23505` — under the
  current unique constraint that means "same transfer already logged, harmless".
- `getTotalPendingPayouts` (`payouts.ts:181`) sums `pending`+`approved` and feeds
  `withdrawableBalanceCents = net − paidOut − pending` (`src/database/queries/earnings.ts:154`).
- RLS on `payouts` still grants photographers INSERT on their own rows
  (`"Photographers can create their own payouts"`), harmless only because nothing pays a `pending` row.
- `source_transaction` binds a transfer to exactly one charge, and Stripe refuses to over-draw a charge.
- Inngest `concurrency` is declared per `createFunction` id, so two registrations mean two independent
  limits.

## Goals / Non-Goals

**Goals:**
- No sale can be stranded without a durable record of the debt.
- No sale can be paid twice, including across a 3-day webhook redelivery and an operator resend.
- Outstanding debts are paid automatically once the photographer's Connect account is active, and
  sub-minimum amounts accumulate until they can be sent.
- The photographer's earnings view stops presenting unsendable money as withdrawable.

**Non-Goals:**
- Transfer reversal on refunds and disputes (T-215). This change only *voids outstanding holds* for a
  refunded charge; it does not reverse a transfer already made.
- Deciding the fate of the admin approval route beyond making it safe (T-220).
- An order-level sweeper for strandings that occur *before* the transfer loop is reached — no charge id on
  the payment intent (`route.ts:597-601`), a guest order whose redelivery short-circuits at
  `getGuestOrderBySessionId` before the transfer block, or a photographer with no `profiles` row (the loop
  iterates `connectStatuses`). Deferred to a follow-up ticket by explicit decision.
- Representing negative amounts. `check (amount_cents > 0)` stands, so reversal rows cannot live in this
  table; T-215 must choose its own model.
- A per-plan payout schedule, minimum threshold, or withdrawal UI.

## Decisions

### D1 — The ledger row is written before the Stripe call, and its id is the idempotency key

Both writers (webhook and retry worker) follow one path:

```
insert payouts row (charge, photographer, amount, currency) -> 'processing'
   23505 ? -> another writer owns this (charge, photographer): do nothing, transfer nothing
createTransfer(idempotencyKey = `payout_<row.id>`, source_transaction = charge)
update row -> 'paid' (+ stripe_transfer_id)
on error  -> leave 'processing'; the retry worker re-drives with the SAME key
```

*Why:* the obvious alternative — keep writing the row after the transfer, and add a unique index — cannot
prevent a payment, only erase the evidence of one. Concretely: a held sale is paid by the worker under one
key; Stripe then redelivers `payment_intent.succeeded` (up to 3 days later, past the idempotency window);
the account is active by now, so the webhook transfers again under `transfer_<charge>_<photographer>`, a
key that was never used. The unique index then fires on the *log* insert and, because `23505` is swallowed,
the second transfer exists nowhere in the database. Writing the row first turns the unique index into a
mutual-exclusion primitive instead of a post-hoc audit.

*Why one key for both writers:* two namespaces cannot dedupe against each other. `payout_<row.id>` is
derived from state both writers already share.

### D2 — Batch only what must be batched

Rows whose own `amount_cents >= 50` transfer **individually**, keeping `source_transaction` set to their
charge. Only sub-minimum leftovers aggregate, grouped by `(photographer_id, currency)`.

*Why:* aggregating across charges forces `source_transaction` to be dropped (a transfer has at most one
source charge), which silently changes the funding model — the transfer then draws on the platform's
*available* balance. Card funds are pending for days, and if the platform sweeps its balance to its bank,
every batch fails `balance_insufficient`. Keeping `source_transaction` on the money that doesn't need
batching also preserves the charge→transfer link in the Stripe dashboard (which T-215 will need) and adds a
second, permanent double-pay guard: Stripe refuses a transfer that would over-draw a charge, and unlike an
idempotency key that never expires. The alternative — batching everything — was rejected for those reasons;
sub-minimum leftovers keep the source-less path, where the amounts and therefore the blast radius are tiny.

### D3 — Reuse `payouts` with `pending` / `processing` rather than a new ledger table

*Why:* T-220 asks whether to revive or prune the `pending` status; this change is what gives it meaning.
Reusing the table means `getTotalPendingPayouts` / `getTotalPaidOut` already aggregate the right things and
the earnings summary needs no new query. A separate ledger table would duplicate that aggregation and leave
`payouts` still vestigial.

`getTotalPendingPayouts` must be widened to include `'processing'`; otherwise an in-flight amount is in
neither the paid nor the pending sum and `withdrawableBalanceCents` inflates by exactly that amount.

### D4 — `(stripe_charge_id, photographer_id)` is the exactly-once key, not `order_id`

A partial unique index (`where stripe_charge_id is not null`) on that pair. `UNIQUE(stripe_transfer_id)` is
dropped because one aggregated transfer settles several rows; the separate lookup index
`idx_payouts_stripe_transfer_id` stays.

*Why the charge and not the order:* a payment intent whose first charge fails and whose second succeeds
legitimately produces two charges for one order. Keying on the order would collapse them. The transfer loop
already groups line items per photographer (`route.ts:119-127`), so one row per pair is exactly right.

Consequence: `createPayoutFromTransfer` must take a **required** `stripe_charge_id` (so the typecheck names
every call site — a call that omits it silently loses all idempotency once the transfer-id constraint is
gone) and must stop swallowing `23505`. After the drop, that error means a probable double payment and has
to be loud.

### D5 — Legacy `pending` rows are excluded structurally

The retry worker selects only rows with `stripe_charge_id is not null and hold_reason is not null`.

*Why:* the self-INSERT RLS policy has been live since 2025, and `createPayout` writes `pending` rows with
neither field. Once a worker pays `pending` rows, any such row would become real money. Filtering on the two
fields the ledger itself always sets is a structural exclusion that does not depend on a data migration
having run correctly; the migration additionally stamps existing rows so the intent is on the record.

### D6 — Dropping the photographer write policies is part of this change, not a follow-up

`"Photographers can create their own payouts"` (INSERT) and `"Photographers can cancel their own pending
payouts"` (UPDATE) are dropped in the same migration that makes `pending` payable.

*Why:* this change is what converts those policies from harmless to a direct money-theft vector, so it owns
the fix. `createPayout` is dead code (only `test/integration/queries/payouts.test.ts` calls it, via the
service role), so nothing user-facing regresses. The table keeps its SELECT policy, so it does not become an
`rls_enabled_no_policy` advisor finding and `scripts/advisors-baseline.ts` needs no entry.

### D7 — One Inngest function, two triggers

`triggers: [{cron: '10,40 * * * *'}, {event: 'payouts.retry-requested'}]`, `concurrency: {limit: 1}`, plus a
debounce keyed on the photographer id.

*Why:* `concurrency` is declared per function id, so registering the cron and the event handler separately
would give two independent limits and allow genuinely concurrent runs for the same photographer. The
debounce matters because Stripe emits `account.updated` in bursts as capabilities flip. The `10,40` slot is
free — `0,30` is storage cleanup and `15,45` is indexing reconciliation.

The claim itself (`update … where id = any(...) and status = 'pending'` returning rows) is safe under READ
COMMITTED: the predicate is re-evaluated after the row lock, so two claimers get disjoint sets. What is not
automatically safe is the aggregation threshold, hence D8.

### D8 — Re-check the minimum against the rows actually claimed, and release when short

The pre-claim read decides which groups look payable; the claim decides which rows are actually ours. The
transfer amount and the minimum check must both be recomputed from the claim's `returning` set, and if the
claimed total falls under the minimum the rows are released back to outstanding.

*Why:* otherwise a concurrent runner that took part of the group leaves a short claim, Stripe rejects the
transfer, the error is cached under that key for 24 hours, and the rows sit in flight forever — excluded
from every future batch. Releasing is safe precisely because no Stripe call was issued for that claim.

### D9 — The batch id comes from the claimed rows, never from a local variable

Generated in SQL / inside a `step.run` and read back out of the claim's `returning`.

*Why:* the repo's Inngest pattern re-executes the flow body on retry. A `crypto.randomUUID()` in the body
would mint a new id — and therefore a new idempotency key — on every replay, re-transferring rows that are
already in flight.

### D10 — `charge.refunded` voids outstanding holds

*Why:* today a stranded hold is accidentally protected by being stranded. Making holds payable without this
would create a new loss the current code does not have: a refunded buyer's money sent to the photographer.
Voiding is the minimum that keeps this change loss-neutral; reversing transfers already made is T-215.

### D11 — The admin route refuses in-flight and ledger-tracked rows

*Why:* `updatePayoutStatus` accepts any status for any id. Flipping a row mid-transfer desyncs the ledger
from Stripe, and cancelling a hold makes it permanently unpayable, because the unique key then blocks
creating a replacement row for that charge. Two guards (`processing`, or a non-null `stripe_charge_id`) keep
the vestigial route from corrupting live state without deciding its future, which is T-220's call.

### D12 — Replace the "Available Balance" card rather than add a fifth

*Why:* once every euro is `paid`, `pending` or `processing`, `withdrawableBalanceCents` is structurally
about zero, and no withdrawal UI exists behind that card — it currently promises money that cannot arrive.
The honest pair is *pending with us* versus the live Stripe balance card directly below it, which is money
already in the photographer's own account.

## Risks / Trade-offs

- **Sub-minimum batches draw on the platform's Stripe balance** (no `source_transaction`) → amounts are by
  definition under 50 cents each; a `balance_insufficient` failure leaves the batch in flight and it is
  re-driven on a later tick rather than lost.
- **A batch stuck in flight past Stripe's 24-hour idempotency window could re-transfer** → before re-driving
  a stale batch the worker probes `stripe.transfers.list({transfer_group})` (confirmed present in the pinned
  `stripe@22.3.2`, `TransferListParams.transfer_group`), cross-checks destination **and** amount, and treats
  a failed probe as *unknown → do not transfer* rather than as "none found".
- **A permanently broken destination leaves rows in flight forever with no alert** → accepted for this
  change; the rows are visible in the ledger and on the earnings view. An attempt counter with an alert is
  noted as a follow-up.
- **Dropping `UNIQUE(stripe_transfer_id)` weakens a guarantee** → replaced by the stronger
  `(charge, photographer)` key, which prevents the payment rather than deduplicating its log. The
  transfer-id lookup index is kept.
- **`set_payouts_paid_at` is a BEFORE UPDATE trigger that overwrites `paid_at` with `now()`** → the settle
  path cannot store the transfer's own timestamp there; the Stripe transfer id remains the join key for
  reconciliation.
- **New Inngest function may not run in production** → production has silently drifted before (5 of 13
  functions registered). Deployment must confirm the function in the Inngest dashboard; this is a manual
  step, called out in the tasks.
- **Strandings before the transfer loop remain open** → explicitly deferred to a follow-up ticket, filed
  when this one is archived.

## Migration Plan

1. `supabase/migrations/20260807000000_add_payout_ledger.sql` — additive columns, `'processing'` added to
   the status CHECK (drop-then-add), `UNIQUE(stripe_transfer_id)` dropped by constraint name, partial unique
   on `(stripe_charge_id, photographer_id)`, sweep index, existing `pending` rows stamped, the two
   photographer write policies dropped. Idempotent (`if not exists` / `if exists`) throughout.
2. Ship code and migration together. The migration is applied by the GitHub Action on merge to main, not by
   Vercel; if that workflow is red the migration must be applied by hand before the code is live.
3. **Rollback is inert.** Reverting the code leaves the new columns unread and any outstanding rows unpaid —
   exactly the pre-change behaviour, minus the fact that the debt is now recorded. No down-migration.
4. Post-deploy: confirm `retry-pending-payouts` appears in the Inngest dashboard, and confirm the Stripe
   endpoint is subscribed to the events the handler processes (the header list in `route.ts` is pinned by
   `test/unit/api/stripe-webhook-setup-doc.test.ts`).

## Open Questions

None blocking. Deferred by explicit decision: the order-level sweeper (its own ticket), transfer reversal on
refunds and disputes (T-215), and the fate of the admin approval route (T-220).
