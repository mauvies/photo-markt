## 1. Shared purchasability predicate

- [x] 1.1 Add `getPurchasablePhotoIds(supabase, photoIds): Promise<Set<string>>` to
      `src/database/queries/photos.ts` (inner join to `events`, filter `upload_status = 'approved'`
      and `events.deleted_at IS NULL`)
- [x] 1.2 Unit/integration test: hard-deleted id excluded, soft-deleted-event id excluded,
      non-approved id excluded, fully-purchasable id included, empty input returns empty set

## 2. Authenticated cart self-heal + notice (A, C)

- [x] 2.1 Add `getCartItemPhotoIds(supabase, cartId): Promise<string[]>` to `src/database/queries/carts.ts`
      (raw, unfiltered)
- [x] 2.2 Add `deleteCartItemsByPhotoIds(supabase, cartId, photoIds): Promise<void>` to
      `src/database/queries/carts.ts` (scoped to one cart)
- [x] 2.3 Update `getCurrentCart()` (`src/app/[lang]/dashboard/talent/cart/actions.ts`): fetch raw ids →
      compute purchasable set → delete unpurchasable rows (if any) → call existing
      `getCartItemsWithDetails` unchanged → return `removedCount` on `CartData`
- [x] 2.4 Update `CartContent` (`cart-content.tsx`) to show a toast when `cartData.removedCount > 0`
- [x] 2.5 Regression test (integration): a cart item whose event was soft-deleted is deleted from
      `cart_items` and reported in `removedCount` on next `getCurrentCart()` call
- [x] 2.6 Regression test (integration): a cart item whose photo's `upload_status` flipped to
      `rejected` is deleted and reported the same way
- [x] 2.7 Regression test (integration): a fully-clean cart reports `removedCount: 0` and deletes
      nothing
- [x] 2.8 Regression test (integration, proves the existing FK cascade): deleting a photo (or an
      event that cascades to it) that another user has in their cart results in that `cart_items` row
      being gone — no application code required, just documents/pins the existing DB behavior

## 3. Guest cart validation + notice (B, C)

- [x] 3.1 Add `loadGuestCartStateAction(photoIds: string[]): Promise<{ removedPhotoIds: string[];
      previews: Record<string, string | null> }>` to `src/app/[lang]/cart/actions.ts` — computes the
      purchasable set (task 1.1), splits `photoIds`, calls the existing (unmodified)
      `resolveGuestCartPreviewsAction` for the valid subset
- [x] 3.2 Update `GuestCartContent` to call `loadGuestCartStateAction` instead of
      `resolveGuestCartPreviewsAction` directly; on a non-empty `removedPhotoIds`, call `removeItem()`
      for each and show the removal toast (guard against re-firing on refetch)
- [x] 3.3 Regression test (unit, component): a guest cart item whose photo id is reported as removed
      is dropped from the rendered list and the removal toast fires
- [x] 3.4 Regression test (integration): `loadGuestCartStateAction` excludes an unpurchasable id from
      both `previews` and reports it in `removedPhotoIds`

## 4. Checkout re-validation (D)

- [x] 4.1 Update `createCheckoutSessionAction` (`dashboard/talent/cart/actions.ts`): check the RAW
      cart_items photo id list against `getPurchasablePhotoIds` (not the already-filtered
      `getCartItemsWithDetails` output, which would silently miss a soft-deleted-event item in a
      mixed cart); throw the translated "review your cart" error if any fail, before creating the
      Stripe session
- [x] 4.2 Update `createGuestCheckoutSessionAction` (`src/app/[lang]/cart/actions.ts`): replace the
      per-item "Photo not found" throw with a single `getPurchasablePhotoIds` check across all
      requested ids; throw the same translated error if any fail
- [x] 4.3 Regression test (integration): authenticated checkout throws and never calls Stripe when the
      cart contains a photo whose event was soft-deleted or whose `upload_status` isn't `approved`
      (including a MIXED cart with one good + one bad item, proving it doesn't silently charge for
      just the good one)
- [x] 4.4 Regression test (integration): guest checkout throws and never calls Stripe under the same
      conditions, and the error message is the friendly translated one (not "Photo X not found")
- [x] 4.5 Regression test (integration): both checkout paths still succeed unchanged when every item
      is purchasable (no false positives)

## 5. i18n

- [x] 5.1 Add `cart.itemsUnavailableRemoved` to `src/dictionaries/en.json` and `es.json`

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green
- [x] 6.2 Run `/code-review` on the diff (touches payments + cross-user DB deletion) and fix real
      findings. Fixed: (1) checkout failure in both cart surfaces didn't invalidate/re-validate the
      cart query, so a self-healed cart (or a guest cart with a now-invalid item) kept rendering
      stale state and could be retried indefinitely, burning the guest-checkout rate limit; (2)
      `getCartItemCount` (header badge) wasn't migrated to the new purchasable-photo predicate and
      could disagree with the cart page. Declined as an accepted trade-off (already documented in
      design.md): the extra purchasability round trip in `getCurrentCart`/checkout instead of folding
      it into `getCartItemsWithDetails`'s existing select — deliberate, to keep one single predicate
      function instead of re-deriving the filter inline at each call site. Unrelated toolbar
      padding/CSS findings were from other uncommitted work already sitting in the shared working
      tree (not part of this branch's diff) and were left untouched.
