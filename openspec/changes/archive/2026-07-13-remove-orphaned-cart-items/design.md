## Context

Research of the current codebase (deletion flows, `carts.ts`, checkout actions, schema migrations)
found two things that reshape the scope described in the ticket:

1. **`cart_items.photo_id references public.photos(id) on delete cascade`** since the table's very
   first migration (`20250213000000_create_carts.sql`), unchanged since. Every photo-delete path
   (`deletePhoto`, `deleteEventPhotosByIds`, `deleteEventPhotos`, the contributor delete action) issues
   a real `DELETE FROM photos ...`. Postgres therefore **already** removes every `cart_items` row
   referencing a deleted photo, for every user, with zero application code. Sub-deliverable A's literal
   ask ("delete cart_items across all users when a photo is deleted") is already true today. What's
   missing is (a) a regression test proving it, and (b) a mechanism for the *buyer's own client* to
   notice and be told about it, since the cascade happens silently, disconnected from any request the
   buyer is making.
2. **Events are soft-deleted** (`events.deleted_at`), never hard-deleted — so a photo whose event was
   deleted is NOT cascade-removed from `cart_items` (the photo row itself still exists). `carts.ts`
   already silently excludes these from `getCartItemsWithDetails`/`getCartItemCount` (T-040), with no
   notice and no actual row cleanup — they linger in `cart_items` forever.
3. **`photos.upload_status`** (`approved`/`pending`/`rejected`) is never checked anywhere in the cart or
   checkout path today. A photo approved when added to cart could later be rejected (moderation
   reversal) and would still silently sit in the cart / be chargeable at checkout.
4. Neither checkout action re-validates purchasability today. The guest checkout throws an abrupt,
   untranslated "Photo X not found" for a hard-deleted photo id (ungraceful, all-or-nothing) and checks
   nothing else; the authenticated checkout does no re-validation at all beyond what
   `getCartItemsWithDetails`'s existing (deleted_at-only) filter happens to exclude.

## Goals / Non-Goals

**Goals:**
- One single source of truth for "is this photo currently purchasable" (exists, `upload_status =
  'approved'`, event not soft-deleted), used by guest-cart validation, authenticated-cart cleanup, and
  both checkout paths.
- Authenticated cart: on load, detect any `cart_items` row that's gone unpurchasable (event
  soft-deleted, or `upload_status` no longer approved — the hard-delete case is already gone via
  cascade), actively delete those rows, and surface a count so the UI can notify the user.
- Guest cart: on cart page load, validate the localStorage photo ids against the same predicate, drop
  invalid ones client-side, and notify.
- Checkout (both paths): re-check purchasability immediately before creating the Stripe session; if
  anything is invalid, reject the checkout attempt with a clear message rather than silently charging a
  different (smaller) cart than what the buyer saw — the next cart load then self-heals via the above.
- Regression tests proving: (a) the existing FK cascade truly empties another user's `cart_items` on
  photo/event delete, (b) guest cart validation strips an unpurchasable id, (c) checkout rejects before
  calling Stripe when the cart contains an unpurchasable item.

**Non-Goals:**
- No new Inngest job — the FK cascade already handles cross-user deletion; no async job is needed for A.
- No schema/migration changes — no new columns, no FK changes.
- No changes to `orders`/`order_items` (historical purchase records stay untouched).
- No enumeration of *which* items were removed in the notice copy — a single generic toast is enough;
  listing item names is explicitly "if feasible" in the ticket and adds UI complexity out of proportion
  to the ask.
- No change to `addPhotoToCartAction` (preventing the initial add of a non-approved photo) — out of the
  ticket's stated scope (removal on deletion/unavailability, not add-time gating).

## Decisions

### D1: `getPurchasablePhotoIds` as the single predicate, in `photos.ts`
```ts
export async function getPurchasablePhotoIds(
  supabase: SupabaseServerClient,
  photoIds: string[],
): Promise<Set<string>>
```
Implemented as one query: `photos` inner-joined to `events`, filtered to
`upload_status = 'approved'` and `events.deleted_at IS NULL`, `.in('id', photoIds)`. Returns the subset
of the requested ids that are currently purchasable — callers diff against their input list to find
what's gone bad. Placed in `photos.ts` (not `carts.ts` as the ticket's notes suggested) since it's a
pure photos+events predicate with no cart involvement — matches the "queries live in their domain
file" convention. Always called with `supabaseAdmin` (a system-integrity check, not a user-scoped read;
matches the guest checkout's existing use of `supabaseAdmin` for the same class of check).

### D2: Authenticated cart — raw-id fetch + purge, not a rewrite of `getCartItemsWithDetails`
Rather than teaching `getCartItemsWithDetails` (existing, tested, used by both the cart page and
checkout) to also filter `upload_status` and stop filtering `deleted_at` at the query level, add two
small new queries in `carts.ts`:
- `getCartItemPhotoIds(supabase, cartId): Promise<string[]>` — raw, unfiltered `photo_id` list for a
  cart.
- `deleteCartItemsByPhotoIds(supabase, cartId, photoIds): Promise<void>` — scoped delete for a specific
  cart.

`getCurrentCart()` (`dashboard/talent/cart/actions.ts`) sequences: fetch the raw id list → compute
purchasable ids via D1 → delete the unpurchasable rows (if any) → call the existing, unmodified
`getCartItemsWithDetails` (whose display-side deleted_at filter now never has anything to exclude,
since the bad rows are already gone) → return `{ items, subtotalCents, itemCount, removedCount }`.
This keeps `getCartItemsWithDetails` and its existing tests completely untouched, and reuses one
predicate for both the "what's wrong" question (raw ids) and the cleanup action.

**Alternative considered:** move the purchasability filter into `getCartItemsWithDetails` itself and
have it return removed ids inline. Rejected — it conflates a display query with a mutation
(`DELETE`) and risks its existing T-040 regression coverage; a separate raw-fetch + purge step ahead of
the existing call is a smaller, easier-to-review diff.

### D3: Guest cart — a single combined Server Action, reusing T-115's preview resolver
New `loadGuestCartStateAction(photoIds: string[]): Promise<{ removedPhotoIds: string[]; previews:
Record<string, string | null> }>` in `src/app/[lang]/cart/actions.ts`: computes the purchasable set (D1),
splits `photoIds` into valid/removed, and calls the existing `resolveGuestCartPreviewsAction` (T-115,
unmodified) for just the valid ids. `GuestCartContent` calls this once per cart load instead of calling
the preview resolver directly; `removedPhotoIds` drives both `removeItem()` calls against the guest
cart provider and the notice toast. One network round trip from the client, two small DB queries
server-side.

### D4: Checkout — reject, don't silently shrink
Both `createCheckoutSessionAction` and `createGuestCheckoutSessionAction` call D1 against their cart's
photo ids immediately before creating the Stripe session. If any id isn't in the purchasable set, throw
a translated error ("One or more items in your cart are no longer available. Please review your cart.")
instead of proceeding with a smaller cart. Replaces the guest path's current raw, untranslated
"Photo X not found" per-item throw with the same predicate and the same friendly message used
everywhere else.

**Alternative considered:** silently drop invalid items and charge for the remaining valid ones.
Rejected — charging a different (smaller) amount than what the buyer saw when they clicked "checkout,"
without an explicit re-confirmation step, is a worse UX than asking them to review a freshly-cleaned
cart and try again; it also keeps the checkout code simpler (no partial-cart Stripe line-item
rebuilding).

### D5: Notice copy and trigger
One new i18n key pair, `cart.itemsUnavailableRemoved` (en/es), matching the existing flat,
present-tense-toast naming convention (`cartRestored`, `checkoutFailed`). Fired via `toast()`:
- Guest: in `GuestCartContent`, when `loadGuestCartStateAction` returns a non-empty `removedPhotoIds`.
- Authenticated: in `CartContent`, when `getCurrentCart()`'s result has `removedCount > 0`.
Both are naturally one-shot: once the bad rows are deleted (auth) or filtered out of the localStorage
cart (guest), a subsequent load recomputes a clean state with nothing left to remove.

## Risks / Trade-offs

- [Two extra small queries per cart-page load (raw id fetch + purchasability check) instead of one] →
  Acceptable: cart sizes are small (single-digit to low-tens of items), and this only runs on the cart
  page itself, not on every render.
- [Checkout now hard-rejects instead of auto-healing the cart for the buyer inline] → Mitigation: the
  rejection message tells the buyer to review their cart, and the very next cart-page load self-heals
  and shows the notice — one extra click, but never a surprise charge.
- [`getPurchasablePhotoIds` is a second query in the guest checkout path beyond the existing photos
  select used for pricing] → Accepted deliberately (D1) to keep purchasability logic in exactly one
  function rather than re-deriving the same filter inline in two places.

## Migration Plan

No schema changes, no data migration. Pure application-code change, deployed as a normal PR merge.
Rollback is a plain revert — no backward-compatibility shims needed since no persisted data shape
changes.

## Open Questions

None — the FK-cascade finding removed the main ambiguity (whether a new cross-user delete job was
needed); the remaining decisions (reject-vs-shrink at checkout, notice granularity) are made above.
