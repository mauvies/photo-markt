## 1. Remove the checkout gate

- [x] 1.1 Delete the `photographer_not_connected` block in `src/app/[lang]/cart/actions.ts:249-255` and drop the `getPhotographerConnectStatuses` import if it becomes unused
- [x] 1.2 Delete the same block in `src/app/[lang]/dashboard/talent/cart/actions.ts:466-472` and drop its import likewise
- [x] 1.3 Confirm nothing else in either action changed — pricing, bundle allocation, service fee and session metadata must be byte-identical

## 2. Retire the unreachable error code

- [x] 2.1 Remove `photographer_not_connected` from `CheckoutErrorCode` and its `checkoutErrorMessageKey` case in `src/lib/checkout-error.ts`
- [x] 2.2 Follow the typecheck to remove `checkoutPhotographerNotConnected` from `en.json`/`es.json` and from the translation props of `cart-content.tsx` and `guest-cart-content.tsx`
- [x] 2.3 Update `test/unit/src/lib/checkout-error.test.ts` so the code list matches the new union

## 3. Reshape the photographer warning

- [x] 3.1 Extend `resolvePayoutReadiness` in `src/lib/payouts/payout-readiness.ts` to take `heldCents` and return `money_held` / `sales_will_hold` / `setup_pending` / `null`
- [x] 3.2 Rename `eventSalesBlockedByPayouts` to `eventEarningsWillBeHeld` and rewrite the module docblock — the premise "cannot be bought" is no longer true
- [x] 3.3 Replace `salesBlockedOne` / `salesBlockedMany` / `eventSalesBlocked` in both dictionaries with copy stating the money is held and sent automatically on connecting
- [x] 3.4 Pass `heldCents` from `getTotalPendingPayouts` into the dashboard banner in `dashboard/photographer/page.tsx`, and map the three states to severity in `_components/stripe-connect-banner.tsx`
- [x] 3.5 Update the per-event notice in `dashboard/photographer/events/[id]/page.tsx` to the new predicate name and copy

## 4. Tests

- [x] 4.1 Invert `test/integration/actions/guest-checkout.test.ts:103` — the guest checkout now succeeds for a non-connected photographer
- [x] 4.2 Invert `test/integration/actions/cart-inventory-integrity.test.ts:289` — same for the authenticated checkout
- [x] 4.3 Check whether `test/integration/api/` already asserts the `connect_inactive` hold from T-216; extend it rather than duplicate, so a sale from a non-connected photographer provably leaves a `pending` row with a `hold_reason` and a `stripe_charge_id` (i.e. payable by the worker)
- [x] 4.4 Extend `test/unit/lib/payout-readiness.test.ts` for the three severities and `test/unit/components/stripe-connect-banner.test.tsx` for the new copy

## 5. Verify

- [x] 5.1 `pnpm typecheck && pnpm lint`
- [x] 5.2 `pnpm test` (unit + integration against local Supabase)
- [x] 5.3 `pnpm build` — `src/lib/` and `src/database/queries/` are touched
- [ ] 5.4 `/code-review ultra` over the diff — **user-triggered and billed; cannot be launched from here.** Left open deliberately: it is the reviewer gate before merging, not a step the agent can tick

## 6. Documentation and backlog

- [x] 6.1 Rewrite the T-248 paragraph in `CLAUDE.md` §Photographer Payouts — its "cannot be bought at all" premise is now false
- [x] 6.2 Add a line to `ARCHITECTURE.md` §4.3: checkout no longer filters on Connect, so `connect_inactive` becomes the ordinary way a hold is born
- [x] 6.3 Rewrite the T-248 archive entry in `backlog/BACKLOG.md` and the ticket in `backlog/tickets/done/` to record the final decision
- [x] 6.4 Capture the photographer sale email ("you sold — connect your account to get paid") as a new ticket with `/ticket`
- [x] 6.5 Commit onto `fix/priced-event-needs-payout-account`, push, and update the PR #305 description to the new behaviour
- [ ] 6.6 `/opsx:archive` this change
