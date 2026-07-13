## Why

Deleting a photo or event (photographer withdrawing inventory) does not currently clean up
`cart_items` for other users who already added that photo to their cart, nor does it invalidate
guest carts (localStorage) or re-check cart contents at checkout. A talent user can therefore be
charged for — or shown a broken preview for — a photo that no longer exists. This is a standard
marketplace integrity gap: a cart must never let someone pay for inventory the seller withdrew.

## What Changes

- Deleting a photo (single, bulk, or via event-delete cascade) now also deletes any `cart_items`
  rows referencing that photo, across ALL users who had it in their cart — not just within the
  deleting photographer's own data.
- Guest cart (localStorage) contents are validated server-side when the cart page loads: each
  `photo_id` is checked against a shared "purchasable" definition (photo not deleted, `approved`,
  event not soft-deleted) and invalid entries are dropped before render.
- Both cart surfaces (authenticated and guest) show a clear notice when items were removed because
  they're no longer available.
- Checkout session creation (both authenticated and guest) re-validates every cart item against the
  same "purchasable" definition immediately before creating the Stripe session — a deleted photo can
  never be charged, independent of whether A/B already caught it.
- New shared query `getPurchasablePhotoIds` (single source of truth for "purchasable") backs B and D.
- New shared query `deleteCartItemsByPhotoIds` (service-role, cross-user) backs A.

## Capabilities

### New Capabilities
- `cart-inventory-integrity`: cart items (both authenticated `cart_items` rows and guest
  localStorage entries) must always reference a photo that currently exists and is purchasable —
  covering cleanup on deletion, live guest-cart validation, user notice, and checkout-time
  re-validation.

### Modified Capabilities
(none — no existing spec covers cart/checkout behavior yet)

## Impact

- **Server Actions (mutations)**: photo delete (single + bulk) and event delete actions gain a
  cart-cleanup step; `createCheckoutSessionAction` (authenticated) and
  `createGuestCheckoutSessionAction` (guest) gain a pre-Stripe purchasability re-check.
- **Database queries** (`src/database/queries/carts.ts`, `src/database/queries/photos.ts`): two new
  queries — `deleteCartItemsByPhotoIds`, `getPurchasablePhotoIds`.
- **Guest cart client surface** (`src/app/[lang]/cart/actions.ts`, `guest-cart-content.tsx`,
  `guest-cart-provider.tsx`): a new/extended Server Action validates guest cart photo ids on load
  and the provider drops invalid entries; a toast/notice informs the user.
- **Auth cart surface** (`dashboard/talent/cart/actions.ts`, `cart-content.tsx`): removal notice
  when server-side cleanup already dropped items before the page loaded.
- **i18n**: new `en.json`/`es.json` strings for the removal notice.
- **No schema/migration changes** — reuses existing `cart_items`, `photos`, `events` columns.
- **Out of scope**: `orders`/`order_items` (historical purchase records) are never touched.
