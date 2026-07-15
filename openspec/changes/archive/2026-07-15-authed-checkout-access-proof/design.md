## Context

T-132 introduced `isEventAccessible(event, shareCodes)` and `getAccessiblePhotoIds` and applied them at the
authed add, the guest merge, and the guest load/checkout boundaries. The authed checkout
(`createCheckoutSessionAction`) and the authed cart self-heal (`getCurrentCart`, T-117) were left validating
only purchasability (`getPurchasablePhotoIds`). The blocker for closing the gap in T-132 was that
`cart_items` carries no record of the share code the buyer presented at add time, so checkout had no way to
tell "added with the right code, event still private" (legitimate) from "added when public, now private"
(must refuse). This change persists that proof.

The `cart_items` table today: `cart_id, photo_id, photographer_id, unit_price_cents`. Access is added via
`addPhotoToCart(supabase, cartId, photoId, photographerId, unitPriceCents)` in `queries/carts.ts`.

## Goals / Non-Goals

**Goals:**
- Persist the presented share code per authenticated cart item so checkout and self-heal can re-validate.
- Bring authed checkout to accessibility parity with the guest checkout, without breaking legitimate private
  (share-code) or favorites (tag) purchases.
- Reuse the single `isEventAccessible` rule — no second definition.

**Non-Goals:**
- A general "user proved access to event" grants table (considered and rejected — YAGNI for the cart-only
  need; more RLS/cleanup surface). Proof lives on the cart item and dies with it.
- Retroactively back-filling proof for pre-migration rows (they sit at null and fail closed for private
  events, which is the safe direction).
- The gallery pre-bake leak and `photos.original_url` index (that's T-136) and the guest legacy-item UX
  softening (deferred note, low blast radius).

## Decisions

- **Model: nullable `access_share_code text` on `cart_items`** (confirmed with the user over a grants table).
  Additive, idempotent (`add column if not exists`), rollback-inert (dropping it only loses the proof, and
  checkout then fails closed for private items — no data corruption).
- **Where the code is captured:** `addPhotoToCart` gains an optional `accessShareCode` param;
  `addPhotoToCartAction` passes the `shareCode` it already receives (T-132), `mergeGuestCartAction` passes
  each guest item's `eventShareCode`. Callers presenting no code store null.
- **Re-validation shape:** a shared helper resolves accessibility for a set of authed cart items given each
  item's stored code + the buyer's id. For each item: `isEventAccessible(event, [storedCode].filter(Boolean))`
  OR `isPhotoTaggedForTalent(admin, photoId, userId)` (live). The tag check is the favorites path (no code
  was ever presented) and also a legitimate escape hatch for a photographer who rotated the share code after
  a buyer saved the photo. Both `createCheckoutSessionAction` and `getCurrentCart` call this helper against
  the raw `cart_items` list.
- **Idempotent add + code upgrade:** `addPhotoToCart` is idempotent on `(cart_id, photo_id)`. If a photo is
  re-added later WITH a valid code where the existing row has null, the existing row's null `access_share_code`
  is upgraded to the presented code (a no-op today would strand a legitimately re-proven item). Re-adding
  with no code never clears an existing code.

## Risks / Trade-offs

- **Legacy rows fail closed for private events.** A cart item added before this migration has a null
  `access_share_code`; if its event is private at checkout and the buyer isn't tagged, it's refused. This is
  the intended safe direction, and the blast radius is tiny (a private-event item mid-cart across the deploy).
  The self-heal surfaces it as "removed" the same way T-117 handles unpurchasable items.
- **Tag check couples checkout accessibility to the tag/save surface.** If `tagPhotoForTalent` were an
  open-by-UUID surface, an attacker could tag a private photo then buy it. This is the same class as the bug
  being fixed; the ticket flags auditing that surface. Verified in-scope: the tag insert path is gated (talent
  library actions require the photo to be reachable). Documented, not re-hardened here.
- **Extra per-item read at checkout/self-heal.** The accessibility helper joins `events(is_public, share_code)`
  for the raw id set — one batched query, run alongside the existing purchasability query. No per-item N+1.
