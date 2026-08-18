## Context

Two blocks of six identical lines — `src/app/[lang]/cart/actions.ts:249-255` and
`src/app/[lang]/dashboard/talent/cart/actions.ts:466-472` — refuse a checkout when any photographer in
the cart is not `active` on Stripe Connect, returning `photographer_not_connected`.

Everything needed to do the opposite already exists, built by **T-216**:

- `createTransfersForOrderItems` (`src/app/api/stripe/webhook/route.ts:163-265`) reconciles the live
  Connect status per photographer and, when it is not active, calls `openPayoutRow` with
  `hold_reason: 'connect_inactive'` — the row lands `pending` with the charge id attached.
- `listPayableHolds` (`src/database/queries/payouts.ts:315-333`) selects exactly those rows
  (`status='pending'` AND `hold_reason IS NOT NULL` AND `stripe_charge_id IS NOT NULL`), and
  `retry-pending-payouts` drains them on the `payouts.retry-requested` event that `account.updated`
  emits on activation, with the `10,40` cron as a backstop.
- `voidHoldsForCharge` cancels outstanding holds on `charge.refunded`, so a refund before the
  photographer onboards is already safe.
- The photographer-facing figure exists too: `getTotalPendingPayouts` feeds `pendingPayoutsCents`,
  which `earnings-content.tsx:397-415` renders as an amber alert with a "connect your account" button.

So the gate is the only thing standing between a working design and its use. This branch
(`fix/priced-event-needs-payout-account`, PR #305) already added photographer warnings under the old
premise; their copy must change with the behaviour.

Production state: 5 priced events across 3 `not_connected` photographers vs 1 priced event on the only
`active` one; `payouts` holds a single `paid` row. The change is therefore being made while almost
nothing is at stake.

## Goals / Non-Goals

**Goals:**

- A photographer can sell before finishing Stripe onboarding; the money waits for them rather than the
  sale being refused.
- The photographer learns this from the product, at an urgency matching whether money is actually held.
- One decision point for that urgency, so the dashboard and the event page cannot disagree.

**Non-Goals:**

- No change to the webhook, the retry worker, the `payouts` schema, or its RLS. This change makes an
  existing path reachable; it does not alter it. No migration.
- No buyer-facing disclosure of the photographer's payout state.
- No auto-refund or expiry for money held indefinitely.
- No photographer-facing email. Captured as a separate ticket.

## Decisions

**Delete the gate rather than soften it.** A warning at the buyer's checkout ("this photographer can't
be paid yet, continue?") would leak the photographer's business state to a stranger and give the buyer
a decision they have no basis to make. The buyer's transaction is correct either way; the only party
with something to do is the photographer, so that is the only party told.

**Remove `photographer_not_connected` from `CheckoutErrorCode` instead of leaving it unused.** The
`checkoutErrorMessageKey` switch is exhaustive, so deleting the member makes the compiler enumerate
every dictionary key and translation prop that has to go with it. An unreachable error code left in
place invites a future caller to resurrect the behaviour by accident.

**Severity keys on held money, not on priced events.** The warning shipped on this branch has two
levels decided by `pricedEventCount`. Under the new behaviour a priced event is a *forecast* ("sales
will be held") while an outstanding hold is a *fact* ("€X of yours is waiting"), and those deserve
different urgency. `resolvePayoutReadiness` therefore takes `heldCents` as well and returns three
states — `money_held`, `sales_will_hold`, `setup_pending` — with `null` for an active account.

**`heldCents` comes from `getTotalPendingPayouts`, the same query behind the Earnings alert.** Deriving
a second "amount owed" figure would let the dashboard and Earnings quote different numbers for the same
money, which is exactly the contradiction T-247 was written to remove.

**Keep reconciling the Connect status on the warning surfaces.** The warnings still read the status
through `reconcileAndPersistConnectStatus`, because a stale `pending` would otherwise tell a working
account that its sales are being held. The checkouts need no such care any more — they stop reading the
status at all, which is what incidentally fixes the stale-status sale blocker.

## Risks / Trade-offs

- **The platform holds money owed to a photographer who may never onboard.** → Accepted, with in-app
  alerts as the pressure and automatic payment on activation as the resolution. Auto-refunding the
  buyer was rejected: they already hold the photos, so a refund gifts the product and penalises the
  platform rather than the photographer who did not connect.
- **A long-held row transfers with `source_transaction` against the original charge.** If the platform
  balance has since been swept to the bank, Stripe can refuse it. → It lands in `transfer_failed`,
  which the retry worker already re-drives, so it self-heals; worth watching if it ever appears.
- **A photographer who never signs in sees no warning.** → Real gap, deliberately deferred: the only
  channel that reaches them is email, and no photographer-facing email exists today. Separate ticket.
- **Removing a `CheckoutErrorCode` member touches both cart clients and both dictionaries.** →
  Mechanical, and the exhaustive switch makes the typecheck the enumerator rather than a reviewer.

## Migration Plan

None — no schema change and no data change. Rollback is reverting the commit: the gate returns and any
holds created meanwhile stay valid, still drained by the retry worker on activation. Nothing written
while the gate is off becomes invalid when it is back on.

## Open Questions

None. The three decisions the plan left open — where the change lands (folded into PR #305), what
backstop the held money gets (alerts only), and whether an email ships with it (no, separate ticket) —
were settled before this document was written.
