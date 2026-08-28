## Context

T-216 built the payout ledger: every photographer transfer is now a `payouts` row written **before** the
Stripe call, whose id is the shared idempotency key, with `source_transaction` kept on every individual
transfer. Its design deliberately preserved the charge→transfer link "which T-215 will need". This change
is that use.

What exists today: `charge.refunded` voids `pending` holds and flips `orders.status` to `refunded`;
`ARCHITECTURE.md` §4.3 states plainly that "a transfer already made still needs a manual reversal".
Nothing anywhere calls `stripe.transfers.createReversal`, and the webhook switch has no `charge.dispute.*`
case at all — a dispute today reaches the `default` branch and is logged as "unhandled".

Three constraints shape the design:

1. **`payouts.amount_cents` has a `check (amount_cents > 0)`** that no migration has relaxed. A
   proportional reduction can never write 0.
2. **The partial unique index `(stripe_charge_id, photographer_id)`** blocks INSERTing a replacement row
   for a charge. It does **not** block UPDATEing the existing row — which is what makes "un-void a hold
   when the dispute is won" possible without schema gymnastics. T-237 assumed the index made this
   irrecoverable; that is true only for the INSERT path.
3. **A 500 from the webhook makes Stripe redeliver**, so no money operation may throw out of a case.

## Goals / Non-Goals

**Goals:**
- A lost dispute and a refund both unwind the photographer's money, through one shared code path so the
  two can never disagree.
- Access is revoked the moment a dispute opens, for guests as well as authenticated buyers, and restored
  if the dispute is won.
- Partial reversals are proportional on both sides of the ledger (money sent, money held).
- Every failure is recorded and alerted; none is silent, and none breaks the webhook.

**Non-Goals:**
- Invalidating signed storage URLs already handed out (600 s ZIP / 3600 s page). Revocation is
  prospective; chasing issued URLs would mean re-architecting how photos are served.
- Reworking the event-owner / free-event ZIP branch, which bypasses order status by design.
- The fate of the vestigial admin payout route (T-220) or `createPayout` dead code.
- Any change to how transfers are *made* — T-216 owns that path and it is untouched here.

## Decisions

### D1 — A new `disputed` order status, not a new access-control mechanism

Thirteen-plus read paths already gate on `status = 'completed'`: `getPurchasedPhotoIdsForEvent` (the ZIP
route's authority), the talent library and its counts, the orders page's original-vs-watermarked URL
choice, sales and earnings, and the guest token page's `guestOrder?.status !== 'completed'`. Adding a
status value therefore revokes access **everywhere at once with zero reader changes**, and flipping back
to `completed` restores it.

*Alternatives considered:* (a) reuse `refunded` for disputes — rejected, it lies to the sales/earnings UI
and destroys the information needed to restore on `won`; (b) a separate `disputed_at` column plus a new
predicate — rejected, it means touching every one of those thirteen read sites, which is exactly how a
revocation gets missed at one of them.

### D2 — The reversal idempotency key is `(payout row, its TARGET reversed total)`

`payout_rev_<payoutId>_<targetReversedForRow>`.

Keyed on the target rather than on the delta, because the target is a pure function of Stripe's own state
and therefore reproduces exactly on a redelivery. The body is safe by construction: for a given key the
amount requested is `target − alreadyReversed`, and once a reversal succeeds `already == target`, so the
only call that can ever be made again under that key is the identical retry of one that failed.

*Why not the ticket's suggested `(transfer_id, charge_id)`:* that pair is constant across successive
partial refunds of the same charge, so the second partial refund would silently reuse the first's key and
reverse nothing — the failure mode is invisible, which is the worst kind on a money path.

⚠️ Inherited from T-216 and just as load-bearing here: **a shared idempotency key is worthless unless
the request body matches too.** Stripe compares the whole body and 400s on divergence, so the amount for
a given key must be derived deterministically from state, never recomputed from a moving input.

### D2b — Everything is a TARGET, never a delta to apply

The first implementation applied a proportion to whatever the row currently held. That is wrong in a
webhook: **Stripe redelivers for up to three days**, and this handler makes redelivery routine because
the access half deliberately fails the request on a transient database error. Applying "reduce by a
quarter" twice reduced twice — a hold walked 2000 → 1500 → 1125 → 844 on a single €5 refund,
irrecoverably, since the exactly-once index blocks writing a replacement row.

So every function answers "what SHOULD this row's reversed total be, given what Stripe says happened to
the charge?" and the caller moves the row there. Applying one event five times moves money once, and
refund-then-dispute converges with dispute-then-refund — which matters because **settling a chargeback
by refunding is the normal path**.

Two consequences worth naming:

- **`payouts.amount_cents` is immutable after insert.** The payable amount is
  `amount_cents − reversed_amount_cents`. Keeping the original is also what lets the retry worker's
  recovery probe still recognise a transfer that was actually made, since it matches on the exact amount.
- **An unknown charge total is not a number.** `resolveClawbackTarget` returns `null` and nothing turns
  that into `0`. The previous version passed `chargeTotal ?? 0` and documented it as failing closed; it
  did the opposite, because `0` reads as "nothing was refunded", so the hold stayed fully payable while
  the alert said the transfer had been reversed.

### D2c — Order status is computed from facts, not toggled by verbs

`resolveOrderStatus({fullyRefunded, chargebackOpen, chargebackLost})` in `src/lib/payouts/order-status.ts`.
There is no "restore". Verbs did not compose: settling a chargeback by refunding the buyer put the order
at `refunded`, and then winning the dispute called "restore" and handed a fully refunded buyer permanent
access to the originals. Every handler recomputes and writes the result, which makes the outcome
independent of the order events arrive in and identical however many times they arrive.

⚠️ **A partial refund does NOT revoke access.** Stripe refunds are amounts, not line items, so a partial
refund says nothing about *which* photos it covers. Revoking the whole order was also arithmetically
wrong: it dropped the entire sale out of the photographer's `net` while only the refunded fraction left
`paidOut`, eating the difference from that photographer's other earnings.

### D3 — Proportional against `charge.amount`, and the approximation is documented

`ratio = refundedCents / chargeCents`, applied to the payout row's own `amount_cents`.

`charge.amount` includes the buyer service fee (T-196), so a refund of exactly the fee still reverses a
sliver of the photographer's net. Stripe refunds are **amounts, not line items** — there is no way to
learn which part of the cart a partial refund corresponds to — so any allocation is a guess. Proportional
on the total is the predictable, explainable guess, and it is stated in the kernel's docstring rather
than left for someone to rediscover.

*Alternative considered:* reconstruct the allocation from `order_items` and assume refunds hit photos
before fees. Rejected — it invents a fact Stripe never gave us, and it would disagree with the buyer's
statement.

### D4 — One orchestrator shared by refunds and lost disputes

`applyClawback({ chargeId, target, reason })` in `src/lib/payouts/apply-clawback.ts`
does holds-then-transfers for both callers. T-216's own post-mortem was that its two writers diverged on
`transfer_group` and wedged every retry; the same class of bug is available here if refunds and disputes
each grow their own reversal logic. The pure math lives separately in `src/lib/payouts/clawback.ts` so it
is unit-testable without Stripe or a database, mirroring `batching.ts`.

### D5 — A `processing` row is probed, never guessed

A refund can arrive while a transfer is in flight. The row is `processing`, so it is neither a hold to
reduce nor a paid transfer to reverse. The orchestrator reuses the retry worker's existing recovery probe
`findTransferByGroup(payoutTransferGroup(row.id), destination, amount)` and keeps its fail-closed rule:
`found` → settle the row paid, then reverse; `none` or `unknown` → touch nothing, record and alert.

*Why not just skip it silently, as today:* that is the hole this ticket exists to close. `unknown` must
still mean "do nothing", because reversing a transfer that does not exist and reversing one twice are
both worse than a row a human has to look at.

### D6 — A freeze is scoped to the dispute that caused it, and mirrors what happened to access

`payouts.frozen_by_dispute_id` carries the `dp_…` that froze the row, and closing that dispute clears
exactly the rows carrying its id. Scoping by `void_reason` alone did not survive the normal settlement
path — chargeback opened, refunded to settle it, closed in our favour — because the refund could not
re-stamp the reason, so winning restored a hold for a sale the buyer had been refunded in full.

⚠️ **Whether the frozen row leaves `pending` is not a free choice: it follows ACCESS.** The balance is
`withdrawable = net − paidOut − pending`, `net` counts `completed` orders, and access is revoked by moving
the order off `completed`. So a hold must sit in `pending` exactly while its sale sits in `net`:

- **A real chargeback** revokes access, so the sale leaves `net` and the hold must leave `pending` too —
  otherwise the same money is subtracted twice and the difference is eaten out of that photographer's
  other earnings.
- **An inquiry** deliberately leaves access alone, so the sale stays in `net` and the hold must stay in
  `pending`. Cancelling it — which is what the first implementation did for both — took the hold out of
  `pending` while the sale stayed in `net`, so *opening an inquiry RAISED the photographer's withdrawable
  balance* by exactly the amount just frozen. The precise opposite of freezing.

Either way the row is marked, and it is the mark — not the status — that `listPayableHolds` refuses to
pay. `void_reason` survives as the audit trail of what reversed a row (`'refund' | 'dispute'`), and is
what stops a won dispute un-voiding a hold a refund had voided.

### D7 — `getTotalPaidOut` AND `getTotalPendingPayouts` become net of reversals

`withdrawableBalanceCents = net − paidOut − pending`. A clawed-back sale drops out of `net` (its order is
no longer `completed`), so unless `paidOut` also drops by the reversal the balance is understated by
exactly the reversed amount — permanently. Summing `amount_cents − reversed_amount_cents` over
`('paid','reversed')` keeps the identity true. The `reversed` status is what makes the payout history
tell the photographer the truth instead of still saying "Paid"; adding it to the `PayoutStatus` union
makes the typecheck point at the UI's `satisfies Record<Payout['status'], …>` map. `getTotalPendingPayouts`
subtracts for the mirror reason: with `amount_cents` immutable (D2b), a partially clawed-back hold no
longer shrinks its own column, so without the subtraction the balance would be understated by exactly the
reversed amount.

### D9 — An individual transfer claims its row before calling Stripe

The batch path claimed its rows; the individual path did not, and that was a real double-payment window
rather than a tidiness gap. A run that transferred and then failed to write `settlePayoutPaid` left a paid
row looking `pending`. Within 24h the idempotency key replays Stripe's original answer and hides it — but
the key expires and the row does not, so the next tick sends the money a second time. `source_transaction`
only refuses an over-draw of the charge, which a single share of a multi-photographer order can still fit
inside.

The claim is only safe with a recovery path, or it trades that window for a permanent one: a `processing`
row is invisible to `listPayableHolds` and nothing else looks for it. So `listStaleProcessingSingles`
mirrors `listStaleProcessingBatches` for rows with no batch id, and resolves them with the same probe and
the same fail-closed rule — `found` settles, `none` hands the claim back as a `transfer_failed` hold,
`unknown` touches nothing.

### D8 — Alerts: Sentry for the incident, email for the operator

Sentry gets a stable fingerprint and `subsystem` tags via the lazy-import, PII-stripped pattern already
proven in `src/lib/rate-limit.ts`. The email mirrors `send-face-search-alert.ts` and is gated on an
optional `OPS_ALERT_EMAIL`, so an unconfigured environment degrades to "no email" rather than to a
throw. Neither channel may ever throw into the webhook path.

## Risks / Trade-offs

- **A reversal can push a connected account negative** → That is the accepted product decision (Stripe
  permits it and recovers from future sales), and it is the only alternative to the platform funding a
  sale that was taken back. Mitigated by alerting on every reversal so a photographer left deeply
  negative is visible rather than discovered by them.
- **The migration must land before the deploy** → The webhook would otherwise write a status the CHECK
  rejects, turning every dispute into a 500 and a Stripe retry storm. Migrations are applied by the
  GitHub Action, not Vercel, so a red `migrate.yml` means applying it by hand first. Called out in the
  tasks and in the PR description.
- **Proportional allocation against a fee-inclusive charge slightly over-reverses** (D3) → Sub-cent to a
  few cents on a fee-only refund; documented in the kernel, and the direction is toward the platform
  absorbing less than it does today, never toward overcharging a buyer.
- **A dispute on a guest order whose charge maps to no order row** → The clawback keys on
  `stripe_charge_id` for the ledger and on the payment intent for the order, so the money half still runs
  even if the order half finds nothing; the missing order is alerted rather than assumed benign.
- **`charge.dispute.closed` arrives for four statuses, not two** (`lost`, `won`, `warning_closed`,
  `prevented`) → All four are handled explicitly: `lost` reverses, the other three release the freeze and
  then reconcile, because a refund may have landed while the row was frozen and the refund path only sees
  `pending` rows.
- **An inquiry escalating to a real chargeback is announced by `charge.dispute.updated`**, not by a new
  event → Handling only `created` left the buyer downloading for the entire chargeback (weeks), since the
  inquiry branch leaves access alone by design and nothing revisited it before `closed`. `updated` shares
  the `created` body, which is safe because that body is idempotent: the freeze matches only outstanding
  holds and access is recomputed from Stripe's facts.

## Migration Plan

1. Apply **both** migrations, in order: `20260808000000_add_payout_reversals_and_disputes.sql` (additive
   columns + three widened CHECK constraints) and `20260809000000_scope_payout_freeze_to_dispute.sql`
   (`frozen_by_dispute_id` + its index). Safe on a live database: no data is rewritten, every new value is
   optional, and both are idempotent (`add column if not exists`, `drop constraint if exists`) so a
   re-apply is a no-op. ⚠️ Staging already carries `20260808000000`; production carries neither.
2. Deploy. The new cases only fire once the Stripe Dashboard endpoint subscribes to the dispute events —
   until then behaviour is exactly today's, minus the refund fixes, which need no subscription change.
3. Subscribe the endpoint to **all three** dispute events: `charge.dispute.created`,
   `charge.dispute.updated` and `charge.dispute.closed`. Missing `updated` is not cosmetic — it is how an
   inquiry escalating to a real chargeback arrives, so without it that buyer keeps their access. The
   webhook header doc, validated by `stripe-webhook-setup-doc.test.ts`, is the operator's checklist.

**Rollback:** revert the code. The added columns are inert when unread and the widened CHECK constraints
accept every pre-existing value, so no down-migration is required. Rows already marked `reversed` or
`disputed` would render as unknown statuses in the UI — the only reason rollback is not perfectly silent,
and a reason to roll forward instead if any clawback has already run.

## Open Questions

None blocking. The three product decisions this change depended on — who absorbs a lost dispute, whether
the dispute fee is passed on, and how partial refunds are split — were taken by the user before design
and are recorded in the proposal.
