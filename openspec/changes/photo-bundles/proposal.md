## Why

Sports buyers want *all* their photos, not one — that is Sportograf's entire model and the highest-leverage
addition for this vertical (`docs/BILLING_MODEL.md`, "Optional lever — bundles"). Today the only price a
photographer can set is `events.price_per_photo`, a single unit price, so a buyer with eight matches pays
`8 × unit` or gives up. Billing v2 is live (€0.25 + 3% buyer service fee, commissions 8/4/0), and the
platform's per-sale margin is deliberately thin — the growth lever left is **average order value**, which is
exactly what volume pricing raises.

**A premise from T-200 that this change corrects.** The ticket argues a bundle amortizes the fee's fixed
component "across 8 photos instead of paying it 8 times". The fee is charged **once per checkout session**
(`buildServiceFeeLineItem` is called once, on the whole cart subtotal) — eight photos in one cart already pay
one €0.25. The amortization is real only against the counterfactual of eight *separate* purchases. The honest
economic case for bundles is therefore conversion and AOV: a buyer who would have bought two photos buys
eight, and the 3% component scales with that. Worth doing; not for the stated reason.

## What Changes

- **Volume pricing is a price ladder on the event, not a new purchasable SKU.** An event gains an optional
  ordered list of rungs `{ minQuantity, totalPriceCents }`, **any number of them**, so
  "1 photo €5 · 3+ photos €12 · 8+ photos €20" is one schedule. The purchasable unit stays the individual
  photo; only the *price of the set* changes.
- **One calc point.** `getBundlePriceCents(quantity, unitPriceCents, tiers)` in a new client-safe
  `src/lib/bundle-pricing.ts`: pick the rung with the **greatest** `minQuantity ≤ quantity`, then take
  `min(quantity × unit, rungTotal)`. Cart display and both checkouts call it; nothing re-derives a discount
  inline (the `getBuyerServiceFeeCents` discipline).
- **The photographer sets the rungs**, per event, in the event create/edit form. There is no
  platform-imposed discount schedule.
- **The ladder is shown wherever the unit price is shown today** — event meta line and cards, both event pages,
  the photo detail modal, the selection toolbar, the create wizard's price and review steps, the edit form and
  the photographer's event detail page — plus the public page's schema.org `offers`. A pack the buyer only
  meets in the cart does not convert.
- **"Add all my photos" is one action** after a face search, on both viewers, reusing the multi-select and bulk
  add-to-cart that already exist. Ids come from the buyer's own match set, or from the reveal-gate proven set
  on a gated event — never from a fresh query.
- **Both checkouts price the validated set from the kernel**, and the discounted total is **allocated back to
  per-photo amounts** (largest-remainder, summing to the total exactly) which are what the Stripe line items,
  `order_items`/`guest_order_items` rows, photographer transfers and earnings are all built from. No downstream
  money path learns a new concept.
- **Cart shows subtotal → bundle discount → service fee → total** up front, via the existing shared
  `CartTotals`, plus a nudge ("2 more photos and your cart costs €4.10 less") computed from the same kernel.
- **The buyer service fee rides on the post-discount subtotal** — mechanically true today (it takes whatever
  the validated subtotal is); made explicit so the two specs can't be read as conflicting.
- **Bundles are limited to single-seller events** (`events.type` `solo` / `collaborative`). Organizer events —
  the only ones where one event's photos can belong to several photographers — are **out of scope**: their
  revenue split does not exist yet (`organizer_fee_per_photo_cents` is written at event creation and never read
  by any money path).
- **Kill switch:** an event with no tiers behaves byte-identically to today, and a single constant disables the
  kernel globally. Rollback is a revert, with no data migration.
- **Out of scope (named, not forgotten):** retroactive credit for photos already bought; cross-event or
  all-events passes; organizer-event bundles.

## Capabilities

### New Capabilities
- `photo-bundle-pricing`: the per-event tier schedule, its single calc point and validation rules (floor,
  ordering, must-be-cheaper-than-singles), who may set it, which events are eligible, the up-front cart
  disclosure of the discount, and its interaction with the buyer service fee and the reveal gate.
- `bundle-payout-allocation`: how one discounted cart total becomes truthful per-photo amounts on the order
  rows, so photographer transfers and earnings reflect money that actually changed hands — including the
  invariant that the webhook reads the allocation checkout committed and never recomputes a price.

### Modified Capabilities
<!--
None. `buyer-service-fee` keeps its requirements verbatim: it is specified over "the validated cart subtotal",
and under a bundle the validated subtotal simply *is* the discounted total. The clarification is stated as a
requirement of `photo-bundle-pricing` instead of a delta, so no existing requirement text becomes false.
`minimum-photo-price` is likewise unchanged — the bundle floor is a new rule that reuses the same constant,
not a change to the per-photo rule. `cart-inventory-integrity` is about *what* is in the cart, not what it
costs; bundle pricing is computed over exactly the set that survives its predicates.
-->

## Impact

- **Schema:** one additive nullable column, `events.bundle_tiers jsonb`, plus one additive nullable
  `cart_items.allocated_price_cents`. ⚠️ Prod migrations are applied by hand via MCP while `migrate.yml` is
  blocked on GitHub Actions billing (same step as T-142/T-180/T-182).
- **Code:** new `src/lib/bundle-pricing.ts` (kernel + allocation + validation); `src/database/queries/events.ts`
  (read/write the ladder, migration-gated like `session_end_time`); `src/database/queries/carts.ts`; both
  checkouts (`src/app/[lang]/cart/actions.ts`, `src/app/[lang]/dashboard/talent/cart/actions.ts`);
  `src/app/api/stripe/webhook/route.ts` (read the committed allocation); photographer earnings/sales; i18n
  (`en.json` + `es.json`).
- **UI surfaces** (the full inventory is design D15 — it is the `price_per_photo` grep filtered to render
  paths): event create wizard `step-3-details.tsx` + `step-5-review.tsx` and the wizard storage/schema; the
  edit form (`events/[id]/edit/`); `events/[id]/event-info-card.tsx` + `events/[id]/page.tsx` (a pricing
  section, **not** a top-level tab — that page's tabs are the moderation switcher and **T-178** restructures
  it); `src/components/event-meta-line.tsx`; `events/[shareCode]/page.tsx` (price block + schema.org `offers`);
  `dashboard/talent/events/[id]/page.tsx`; `src/components/photo-detail-modal.tsx`;
  `src/components/photo-album-viewer.tsx`; `src/components/photo-selection-toolbar.tsx`;
  `src/components/cart-totals.tsx` and both carts; both gallery viewers for the "add all my photos" action.
- **Money:** changes what buyers are charged and what photographers net on a discounted sale. Every
  implementation PR requires **`/code-review ultra`**.
- **Owner gate:** approve this design before any child ticket is opened.
