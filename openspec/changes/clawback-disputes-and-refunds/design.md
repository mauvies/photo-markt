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

### D2 — The reversal idempotency key is `(payout row, cumulative refunded amount)`

`payout_rev_<payoutId>_<cumulativeRefundedCents>`.

Stripe redelivers the *same* event with the same `charge.amount_refunded`, so the key is stable and the
redelivery is a no-op. A *second, larger* partial refund carries a different cumulative amount, so it is
legitimately a different operation and gets its own key — and the amount requested is the **delta**
against `reversed_amount_cents`, so the total reversed can never exceed what was transferred.

*Why not the ticket's suggested `(transfer_id, charge_id)`:* that pair is constant across successive
partial refunds of the same charge, so the second partial refund would silently reuse the first's key and
reverse nothing — the failure mode is invisible, which is the worst kind on a money path.

⚠️ Inherited from T-216 and just as load-bearing here: **a shared idempotency key is worthless unless
the request body matches too.** Stripe compares the whole body and 400s on divergence, so the amount for
a given key must be derived deterministically from state, never recomputed from a moving input.

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

`applyClawback({ chargeId, reversedCents, chargeCents, reason })` in `src/lib/payouts/apply-clawback.ts`
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

### D6 — `void_reason` distinguishes a dispute-void from a refund-void

Restoring on `won` must resurrect only what the dispute voided. Matching on the `admin_notes` string
would work today and break the first time someone edits the copy, so the reason is a column with a CHECK
constraint (`'refund' | 'dispute'`).

### D7 — `getTotalPaidOut` becomes net of reversals

`withdrawableBalanceCents = net − paidOut − pending`. A clawed-back sale drops out of `net` (its order is
no longer `completed`), so unless `paidOut` also drops by the reversal the balance is understated by
exactly the reversed amount — permanently. Summing `amount_cents − reversed_amount_cents` over
`('paid','reversed')` keeps the identity true. The `reversed` status is what makes the payout history
tell the photographer the truth instead of still saying "Paid"; adding it to the `PayoutStatus` union
makes the typecheck point at the UI's `satisfies Record<Payout['status'], …>` map.

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
- **`charge.dispute.closed` may arrive for statuses other than `won`/`lost`** (e.g. `warning_closed`) →
  Only the two named statuses act; anything else is logged and ignored, which is the conservative
  direction for money.

## Migration Plan

1. Apply `20260808000000_add_payout_reversals_and_disputes.sql` (additive columns + three widened CHECK
   constraints). Safe on a live database: no data is rewritten and every new value is optional.
2. Deploy. The new cases only fire once the Stripe Dashboard endpoint subscribes to
   `charge.dispute.created` and `charge.dispute.closed` — until then behaviour is exactly today's, minus
   the refund fixes, which need no subscription change.
3. Subscribe the endpoint to the two dispute events (the webhook header doc, validated by
   `stripe-webhook-setup-doc.test.ts`, is the operator's checklist).

**Rollback:** revert the code. The added columns are inert when unread and the widened CHECK constraints
accept every pre-existing value, so no down-migration is required. Rows already marked `reversed` or
`disputed` would render as unknown statuses in the UI — the only reason rollback is not perfectly silent,
and a reason to roll forward instead if any clawback has already run.

## Open Questions

None blocking. The three product decisions this change depended on — who absorbs a lost dispute, whether
the dispute fee is passed on, and how partial refunds are split — were taken by the user before design
and are recorded in the proposal.
