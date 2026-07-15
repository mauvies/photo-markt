## Why

T-132 gated add-to-cart, guest merge, and **guest** checkout on private-event access ("event is public OR
the caller presents the matching share code"), but the **authenticated** checkout
(`createCheckoutSessionAction`) still re-validates only *purchasability*, never *accessibility*. A talent can
add a photo while its event is public, the photographer later flips the event to private (`is_public=false`),
and the now-private photo is still charged and delivered — the guest path blocks this, the authed path does
not. The gap wasn't closed in T-132 because `cart_items` doesn't persist the share code presented at add
time, so a naive accessibility check at checkout would also reject legitimate private purchases (a photo
added with the correct code via `/events/[shareCode]`).

## What Changes

- Persist the access proof at add time: a new nullable `access_share_code` column on `cart_items` records
  the share code the caller presented when the item was added (authed add) or merged (guest→authed).
- `addPhotoToCartAction` and `mergeGuestCartAction` write the presented code into the new column.
- `createCheckoutSessionAction` (authenticated) re-validates accessibility per item against the persisted
  proof, reaching **parity with the guest checkout**: an item is accessible iff its event is public now, OR
  the stored `access_share_code` matches the event's current `share_code`, OR the buyer still has the photo
  tagged (live check — the favorites path presents no code). Anything else is refused, not charged.
- `getCurrentCart`'s self-heal (T-117) drops inaccessible items so the cart view and the checkout agree.
- The accessibility predicate stays the single shared `isEventAccessible` / `getAccessiblePhotoIds` (T-132) —
  no re-derivation.

## Capabilities

### New Capabilities
<!-- none — this extends the existing cart-integrity contract -->

### Modified Capabilities
- `cart-inventory-integrity`: add an **accessibility re-validation** dimension alongside the existing
  purchasability one — the authenticated checkout and the cart self-heal MUST re-validate private-event
  access against a persisted per-item proof, at parity with the guest checkout, without rejecting legitimate
  private or favorites purchases.

## Impact

- **DB migration** (additive, idempotent, rollback-inert): `cart_items.access_share_code text` nullable,
  default null. Legacy rows sit at null → for public events unaffected; for private events they fail closed
  at checkout unless the buyer still holds the tag (the safe direction).
- **Code**: `src/database/queries/carts.ts` (`addPhotoToCart` gains a code param; details/query surface the
  column), `src/app/[lang]/dashboard/talent/cart/actions.ts` (`addPhotoToCartAction`, `mergeGuestCartAction`,
  `createCheckoutSessionAction`, `getCurrentCart`).
- **Security surface**: payments (checkout charge path) + private-event access control → `/code-review ultra`.
- **No API/route changes**; server actions only. No breaking changes to existing callers (the new param is
  optional; public/free flows are unaffected).
