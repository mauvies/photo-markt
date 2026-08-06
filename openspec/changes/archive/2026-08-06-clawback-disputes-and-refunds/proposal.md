## Why

The webhook handles 8 Stripe events and **none of them is a dispute**. When a chargeback is lost today
Stripe pulls the money back out of the platform account and charges a ~€15 dispute fee, while the order
stays `completed` — so **the buyer keeps download access indefinitely**, the photographer keeps the
transfer, and nothing is logged, alerted or recorded anywhere. A €5 photo costs ~€20 and the file is
gone. A dispute is forced unilaterally by the buyer through their bank, bypassing our terms entirely, so
this is precisely the route someone would take to download without paying.

`charge.refunded` is handled, but only halfway: the order flips to `refunded` (which does revoke access
for authenticated buyers) while a transfer already sent to the photographer is never reversed —
documented as "reverse manually via the Stripe Dashboard", i.e. dependent on someone remembering.

## What Changes

- **`charge.dispute.created`** (new): the order — **and the guest order**, see below — flips to a new
  `disputed` status, which revokes download access through the `status = 'completed'` gates that already
  exist on every read path. Outstanding payout holds for the charge are voided with
  `void_reason = 'dispute'`, and an operational alert fires (Sentry + email).
- **`charge.dispute.closed`** (new): `lost` reverses the photographer's transfer for the disputed amount
  and records the dispute fee as a platform cost; `won` restores the order to `completed` and un-voids
  the holds it voided.
- **`charge.refunded`**: now also **reverses an already-sent transfer**
  (`stripe.transfers.createReversal`), keyed on `(payout row, cumulative refunded amount)` so a Stripe
  redelivery is idempotent while a genuinely larger second partial refund is a new operation.
- **Partial refunds are handled proportionally on BOTH sides** (absorbs **T-237**): the reversal is
  proportional to the refunded fraction of the charge, and an outstanding hold has its `amount_cents`
  **reduced** rather than cancelled outright. Today any partial refund voids the whole hold — refund €5
  of a €20 sale and the photographer irrecoverably loses their net on the remaining €15.
- **Guest orders are revoked too.** `charge.refunded` currently resolves the order only through
  `getOrderByPaymentIntentId` (the `orders` table); no `guest_orders` lookup by payment intent exists, so
  a refunded guest keeps a working download-token page until `expires_at`. A
  `getGuestOrderByPaymentIntentId` closes this for refunds and disputes alike.
- **The ledger records the reversal**: `payouts` gains `reversed_amount_cents`, `stripe_reversal_id`,
  `reversed_at`, `void_reason`, and a `reversed` status. `getTotalPaidOut` becomes net of reversals so
  the photographer's balance arithmetic stays coherent after a clawback.
- **A failed reversal never breaks the webhook.** Insufficient balance on the connected account, a
  Stripe outage, or a row mid-transfer are recorded on the row and alerted, and the handler still returns
  200 — a 500 makes Stripe redeliver a money operation.
- **BREAKING (schema, additive):** the `status` CHECK constraints on `orders`, `guest_orders` and
  `payouts` gain a value each. The migration must be applied **before** the deploy or the webhook writes
  a status the constraint rejects.

**Product decisions, already taken and not re-opened by this change:** a lost dispute **reverses the
photographer's transfer** (Stripe permits the resulting negative balance, recovered from future sales);
the **dispute fee is absorbed by the platform**, never charged to the photographer, because they control
neither the buyer's fraud nor the dispute process; partial refunds are **proportional**.

## Capabilities

### New Capabilities
- `purchase-clawback`: when a purchase is reversed by refund or lost dispute, the buyer's access and the
  photographer's money are both unwound — proportionally for a partial reversal — and a dispute that is
  won puts both back.

### Modified Capabilities
- `photographer-payout-ledger`: the requirement "A refunded charge does not pay out" currently mandates
  voiding the whole outstanding hold and is silent on partial refunds. It is widened so a partial refund
  reduces the hold proportionally instead of voiding it, and so the ledger records reversals of money
  already sent.

## Impact

- **Schema:** `supabase/migrations/20260808000000_add_payout_reversals_and_disputes.sql` — additive
  columns on `payouts`; one new allowed value on each of three `status` CHECK constraints.
- **Webhook:** `src/app/api/stripe/webhook/route.ts` — two new cases, a rewritten `charge.refunded`, and
  the header setup doc that `test/unit/api/stripe-webhook-setup-doc.test.ts` validates against the switch.
- **Money code:** `src/database/queries/payouts.ts`, `src/lib/stripe/connect.ts`, and two new modules
  (`src/lib/payouts/clawback.ts` for the pure math, `src/lib/payouts/apply-clawback.ts` for the shared
  orchestration used by both refunds and lost disputes).
- **Access:** `src/database/queries/guest-orders.ts` gains a payment-intent lookup. No read path changes
  — revocation falls out of the existing `completed` filters.
- **Observability:** new `src/lib/observability/report-money-incident.ts` and
  `src/lib/email/send-clawback-alert.ts`, plus an optional `OPS_ALERT_EMAIL` in `env.mjs` (absent ⇒ the
  email is a no-op, mirroring `FACE_SEARCH_ALERT_EMAIL`).
- **UI/i18n:** the earnings payout history gains a `reversed` label in both dictionaries; the
  `satisfies Record<Payout['status'], …>` map makes the typecheck demand it.
- **Docs:** `ARCHITECTURE.md` §4.3 (which currently says T-215 owns automating this) and the payouts
  section of `CLAUDE.md`.
