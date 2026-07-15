## 1. Migration

- [x] 1.1 Add migration `supabase/migrations/<ts>_add_access_share_code_to_cart_items.sql`: `alter table cart_items add column if not exists access_share_code text;` (additive, idempotent, nullable, default null). No RLS change (existing `cart_items` policies already scope by owner).

## 2. Query layer (`src/database/queries/carts.ts`)

- [x] 2.1 `addPhotoToCart`: add an optional `accessShareCode?: string | null` param; write it on insert. On the idempotent `(cart_id, photo_id)` hit, upgrade an existing null `access_share_code` to a newly presented non-null code; never clear an existing code.
- [x] 2.2 Surface `access_share_code` on the item read used for re-validation (a lightweight `getCartItemsAccessInfo` returning `{ photo_id, access_share_code, event_id, is_public, event_share_code }`, or extend the existing details query) — do not conflate with the display-only `event_share_code` join.

## 3. Shared accessibility resolver (`src/database/queries/` or cart actions)

- [x] 3.1 Add `getAccessibleAuthedCartPhotoIds(admin, items, userId)` (or equivalent) that returns the set of photo ids accessible under the rule: event public OR `isEventAccessible(event, [item.access_share_code].filter(Boolean))` OR `isPhotoTaggedForTalent(admin, photoId, userId)`. Reuse `isEventAccessible`; batch the event lookup; batch/short-circuit the tag check.

## 4. Cart actions (`src/app/[lang]/dashboard/talent/cart/actions.ts`)

- [x] 4.1 `addPhotoToCartAction`: pass the already-received `shareCode` into `addPhotoToCart` so it's persisted.
- [x] 4.2 `mergeGuestCartAction`: pass each guest item's `eventShareCode` into `addPhotoToCart`.
- [x] 4.3 `createCheckoutSessionAction`: after the purchasability check, re-validate accessibility for the raw cart items via the resolver; refuse checkout (no Stripe session) if any item is inaccessible, mirroring the guest checkout's error.
- [x] 4.4 `getCurrentCart`: apply the accessibility resolver in the self-heal so inaccessible items are dropped from the returned cart alongside unpurchasable ones.

## 5. Tests (regression: red before / green after)

- [x] 5.1 Migration/query: adding a private-event photo with the correct code persists `access_share_code`; public/favorites add stores null; guest merge carries the stored code.
- [x] 5.2 Checkout: photo added public → event flipped private → authed checkout refuses (untagged); legitimate private-with-code purchase still checks out; favorites (tagged, no code) still checks out.
- [x] 5.3 Self-heal: `getCurrentCart` drops an item whose event went private with no valid proof.
- [x] 5.4 `pnpm typecheck && pnpm lint && pnpm test` green; `pnpm build` green (touches shared query layer).

## 6. Review & docs

- [x] 6.1 `/code-review ultra` on the diff (payments + access control); fix real findings.
- [x] 6.2 Update `CLAUDE.md` cart/checkout notes if the persisted-proof model changes a documented invariant.
