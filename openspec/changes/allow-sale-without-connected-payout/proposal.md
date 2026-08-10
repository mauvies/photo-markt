## Why

Both checkouts refuse a cart whose photographer is not `active` on Stripe Connect, so a priced event
published by an un-onboarded photographer cannot be bought at all — in production that is 5 of the 6
priced events. The refusal is also invisible to the photographer, whose only signal is a buyer asking
why nothing works.

That gate predates **T-216**, which built the entire alternative: the webhook already reconciles the
live Connect status and, when it isn't active, records the photographer's net as a `payouts` row with
`hold_reason = 'connect_inactive'` instead of losing it, and `retry-pending-payouts` drains it the
moment `account.updated` reports the account active. The machinery to sell now and pay later is
finished and unreachable.

## What Changes

- **BREAKING (buyer-visible, in their favour):** checkout no longer refuses a cart because a
  photographer cannot be paid. The sale completes, the buyer gets their photos, and the photographer's
  net is held in the ledger until their account can receive it.
- Remove the Connect gate from both checkout actions (guest and authenticated). Nothing else in either
  action changes — pricing, bundle allocation, the buyer service fee and the session metadata are untouched.
- Remove `photographer_not_connected` from `CheckoutErrorCode` and its dictionary copy: it becomes
  unreachable, and an unreachable error code rots.
- Reshape the photographer warnings introduced on this branch (T-248 / PR #305) so they state what is
  now true. The consequence changes from "nobody can buy" to "your money is waiting", which is a
  different message and a different urgency — so severity keys on whether money is *actually* held
  rather than on whether events merely carry a price.
- Fixes incidentally: neither checkout reconciled the cached Connect status against Stripe, so a
  `pending` left behind by a lagged `account.updated` webhook silently blocked a working account's
  sales. Removing the gate removes that failure mode.
- Deliberately unchanged: the buyer is told nothing about the photographer's payout state — their
  purchase is complete and correct, and the information is not actionable for them.

## Capabilities

### New Capabilities

- `payout-readiness`: what the product does when a photographer who is selling cannot yet receive
  money — that the sale still happens and the money is held rather than refused, and that the
  photographer is warned in proportion to what is actually at stake.

### Modified Capabilities

<!-- None. `photographer-payout-ledger` already specifies that a non-active account produces a
     `connect_inactive` hold that the retry worker drains; this change only makes that path reachable
     in the ordinary case instead of an edge case. No requirement of that spec changes. -->

## Impact

- **Checkout actions:** `src/app/[lang]/cart/actions.ts`, `src/app/[lang]/dashboard/talent/cart/actions.ts`
- **Error plumbing:** `src/lib/checkout-error.ts`, both cart client components, `en.json`/`es.json`
- **Warning surfaces:** `src/lib/payouts/payout-readiness.ts`, the photographer dashboard banner and
  the per-event notice, reusing `getTotalPendingPayouts` (`src/database/queries/payouts.ts`)
- **Unchanged by design:** the Stripe webhook, `retry-pending-payouts`, the `payouts` schema and its
  RLS. No migration.
- **Accepted exposure:** the platform now holds money owed to a photographer who may never onboard.
  Mitigated by in-app alerts plus automatic payment on activation; no auto-refund, since the buyer
  already holds the photos. A photographer-facing email is deliberately out of scope and captured
  as a separate ticket.
