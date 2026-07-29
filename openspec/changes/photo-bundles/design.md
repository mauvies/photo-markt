## Context

Billing v2 is live (T-199): the buyer pays `subtotal + €0.25 + 3%`, the photographer nets
`price × (1 − commission)` at 8/4/0 by tier, and the platform's per-sale margin is thin by design — Pro at 0%
makes a sale roughly break-even, with the margin coming from the subscription. The only per-sale growth lever
left is **average order value**.

What exists today, and what constrains this design:

- **One price per event.** `events.price_per_photo` (numeric EUR), converted to cents at add-to-cart time.
  There is no second price surface anywhere.
- **The cart is a list of photos.** `cart_items(photo_id, photographer_id, unit_price_cents,
  access_share_code)` for authenticated buyers; a `localStorage` array of `GuestCartItem` for guests. Both
  checkouts re-derive every price server-side and ignore whatever the client sent.
- **Checkout builds one Stripe line item per photo**, plus one service-fee line item computed once from the
  whole validated subtotal (`buildServiceFeeLineItem`).
- **The webhook rebuilds orders from the cart, never from `session.line_items`** — from `cart_items` rows
  (authenticated) or from per-item `cart_<i>` JSON in session metadata (guest) — then groups `order_items` by
  `photographer_id` and transfers `getPhotographerNetCents(gross)` per photographer.
- **Entitlement is a per-photo order row.** Downloads, the ZIP route, the talent library, the guest
  download-token page and the sold-photo soft-delete rule (T-142) all key off `photo_id` in
  `order_items` / `guest_order_items`.
- **Sellers per event.** On `solo` and `collaborative` events every `photos.user_id` is the event owner —
  `uploadGuestPhoto` hardcodes `owner_user_id`, so even guest contributions belong to the owner. On
  `organizer` events an accepted contributor's uploads carry the *contributor's* `photos.user_id`, so one event
  can have several sellers. `events.organizer_fee_per_photo_cents` exists but is written at event creation and
  read by no money path — organizer revenue sharing is not implemented.
- **The reveal gate** (T-177) withholds photo ids from a visitor who has not proven a face match, and mints a
  signed proof only on gated events.

## Goals / Non-Goals

**Goals:**
- A photographer can offer "8 or more photos for €19.90" and a buyer sees that price before paying.
- Displayed price and charged price are the same number, from the same function (the billing-v2 discipline).
- Photographer transfers and earnings reflect money actually collected, to the cent, on a discounted sale.
- No new entitlement concept: every existing download/library/refund path keeps working untouched.
- Disable-able by one constant, revertible without a data migration.

**Non-Goals:**
- Organizer-event bundles (needs revenue sharing that does not exist).
- An "add all my face matches to cart" control (must consume the reveal-gate proven set — own ticket).
- Retroactive credit for photos already bought.
- Cross-event bundles, all-event passes, subscription-style buyer plans.
- Coupons or promotion codes (a different Stripe object model, and not what was asked for).

## Decisions

**D1 — A bundle is a PRICE, not a PRODUCT.** The purchasable unit stays the photo; the event carries a price
schedule that changes what a *set* costs. Alternative considered and rejected: a bundle SKU ("you own event E's
bundle"). That would require a second entitlement type threaded through the ZIP route, the library, the
purchased-ids checks, the soft-delete-on-sale predicate and the guest download token, plus rules for photos
added or deleted after purchase — and the buyer cannot perceive any of it. Worse, a product meaning "all photos
of this event" is definitionally the reveal-gate hole (D7): it would have to be defined over photos the buyer
was never shown. Pricing the cart keeps the blast radius inside pricing.

**D2 — The schedule is a list of `{ minQuantity, totalPriceCents }`, and the price is a `min`.**
`getBundlePriceCents = min(quantity × unit, cheapest tier total whose threshold is met)`. Alternatives
considered: percent-off tiers (`{minQty, percentOff}`) — harder for the buyer to reason about, and it makes the
floor rule awkward because the resulting total is derived rather than stated; and an explicit price-per-count
table — verbose and unbounded. Flat totals give the Sportograf headline ("all your photos: €19.90"), and taking
the `min` against the singles price means no configuration, however wrong, can charge more than buying one at a
time. It also makes the next-tier nudge (D9) trivially derivable.

**D3 — One calc point, client-safe, mirroring `getBuyerServiceFeeCents`.** `src/lib/bundle-pricing.ts` imports
nothing server-only, so the cart can display the price the checkout will charge. This is the property that
makes displayed-vs-charged divergence structurally impossible rather than test-enforced, and it is the reason
`plans.ts` was deliberately kept free of `env.mjs` in T-195.

**D4 — The photographer sets the tiers; the platform does not.** A platform-wide discount schedule would cut a
photographer's revenue on their own goods without their consent. The platform's interest (higher AOV) is served
by *any* bundle, whoever authored it, so there is nothing to gain by taking the decision away. Validation is
enforced at write time in both event actions — the `isPhotoPriceAboveFloor` pattern — rather than as a DB
constraint, so a later-tightened rule never breaks an event that is already selling.

**D5 — The bundle floor is `MIN_PHOTO_PRICE_CENTS` applied to the TIER TOTAL, not per photo.** The floor's
stated purpose (T-199) is presentation: at €0.25 + 3% a €0.50 item's fee is over half its price and reads
badly. For a bundle the thing being bought is the set, so the set's total is what the fee must be
proportionate to — a €19.90 bundle of 40 photos carries a €0.85 fee, which is fine, while a per-photo reading
of the floor would forbid it. Reusing the existing constant rather than adding a second one keeps one number to
reason about. Without this rule, tiers would be a trivial way to reintroduce the sub-floor economics T-195
closed.

**D6 — Pricing is grouped by `(event, photographer)`, and v1 only allows single-seller events.** The grouping
is the general rule; the restriction is the v1 scope. On `solo`/`collaborative` events the group *is* the
event, so the common case is unaffected. Organizer events are excluded because a discount there would spend a
contributor's revenue on the organizer's behalf, and because there is no revenue-sharing mechanism to split it
against — `organizer_fee_per_photo_cents` is dead plumbing. Writing the kernel against groups rather than
events now means enabling organizer bundles later is a gate change, not a repricing rewrite.

**D7 — The reveal gate is preserved by construction, not by a new check.** Because there is no event-wide
product, an unproven visitor has nothing to buy: the cart can only contain ids they were served, and the gate
already decides which ids those are. The invariant to carry forward is stated in the spec — no bundle
affordance may enumerate or price photos the buyer has not been shown. A future "add all my matches" control
must read the reveal-gate proven set (`getProvenRevealIds`), which exists only for gated events; on non-gated
events the client already holds the matched ids. That asymmetry is exactly why it is a separate ticket.

**D8 — The discounted total is ALLOCATED back to per-photo cents, and everything downstream reads the
allocation.** This is the load-bearing decision. `order_items.unit_price_cents` feeds
`createTransfersForOrderItems`, which sums per photographer and transfers `getPhotographerNetCents(gross)`. If
the rows kept list prices while the buyer paid a discounted total, the platform would transfer money it never
collected — a real loss on every bundled sale. Allocating with a largest-remainder rule so
`sum(allocated) == bundleTotal` exactly means transfers, earnings, `orders.total_amount_cents`, the
`gross = commission + net` identity (T-197) and refunds all stay correct with **no change to any of them**.

Alternative considered: keep list prices and carry a separate discount amount. Rejected — every consumer of
`unit_price_cents` would then need to learn about the discount and apply it consistently, which is precisely
the "two derivations of one figure" shape that produced the T-197 cent mismatch.

**D9 — Stripe line items are built FROM the allocation, one per photo.** Then the session total equals the sum
of the order rows by construction. Alternative considered: a single aggregated "8 photos (bundle)" line item —
prettier on the receipt, but it introduces a second number that can drift from the row sum, and Stripe has no
negative line item so a visible "discount" line is not available without coupons. The buyer sees the discount
where it matters — in the cart, before paying (D10) — and the receipt shows per-photo amounts that add to the
same total. If receipt legibility ever becomes a complaint, the fix is a line-item *description*, never a
second total.

**D10 — Disclosure in the cart, through the existing shared `CartTotals`.** Subtotal → bundle discount →
service fee → total, in all four render sites (guest and authenticated, desktop and mobile), computed from the
same kernel the checkout charges from. This is the PSD2 requirement billing v2 already satisfies for the fee
(the risk is surprise pricing, not the fee). The next-tier nudge is display-only and free: `getBundlePriceCents`
called at `quantity + k`.

**D11 — The webhook reads a committed allocation and never recomputes.** Tiers are editable at any moment; a
recomputation between charge and delivery would produce an order that disagrees with the card statement.
Carriers: the guest flow already writes per-item cents into `cart_<i>` metadata, so it needs *no new
mechanism* — the allocated amount simply goes in the existing `c` field. The authenticated flow gets a nullable
`cart_items.allocated_price_cents`, written when the session is created and preferred by the webhook when
present. A null allocation falls back to `unit_price_cents`, which reproduces today's behaviour exactly and
makes in-flight sessions from before the deploy safe.

**D12 — No retroactive credit for prior purchases.** Crediting them means either a partial refund — which in
this system does not auto-reverse the photographer's transfer — or a discount funded by a platform with
near-zero per-sale margin. Instead, already-owned photos are excluded from the cart and do not count toward a
threshold, and the next-tier prompt is shown while the cart is still small, which is when the buyer can act on
it. The residual unfairness is accepted and stated rather than hidden.

**D13 — Free events are exempt, and one constant disables the whole thing.** A `price_per_photo` of null or 0
means nothing to discount (same exemption shape as the price floor). Globally, a single constant makes the
kernel return `quantity × unit` everywhere and suppresses every affordance; stored schedules survive unread.
Rollback is a revert with no migration and no repricing of historical orders — the same escape hatch billing v2
shipped with.

**D14 — Storage: `events.bundle_tiers jsonb`, additive and nullable.** One column, no join, read for free
wherever the event is already read. A child table would buy queryability nothing needs. Validation is app-level
(Zod at write, defensive parse at read) in keeping with `isValidSessionRange` and `isPhotoPriceAboveFloor`; the
read path fails closed to *undiscounted* pricing, a direction that can only overcharge relative to the
photographer's intent (visible, refundable) and never undercharge (silent, unrecoverable). Writes are
migration-gated the way `session_end_time` and `organizer_fee_per_photo_cents` are, because prod migrations are
currently applied by hand.

## Risks / Trade-offs

- **A discount is money the photographer gives up, and they may not model it well.** → The floor and the
  must-be-cheaper-than-singles rule bound the obvious mistakes; the effective per-photo price at each threshold
  should be shown in the form as the photographer types.
- **Allocation makes per-photo receipt amounts look arbitrary** (€2.49 for a €3.00 photo). → Accepted; the
  cart discloses the discount explicitly and the sum is what the buyer agreed to. D9 records the fix if it
  becomes a real complaint.
- **A buyer who bought singles first pays more than one who waited.** → D12; mitigated by advertising the tier
  early, accepted otherwise.
- **Tiers are editable mid-session.** → D11 pins the price at checkout; the webhook never recomputes.
- **jsonb has no schema.** → Defensive parse failing closed to undiscounted (D14), plus write-time Zod
  validation, plus a cap on tier count.
- **Bundles interact with three live money paths at once** (checkout, webhook, earnings). → Ship in three
  ordered child tickets with the pricing kernel landing dark, and `/code-review ultra` on every one.
- **The stated economic premise was wrong** (the fee is per checkout, not per photo — see the proposal). →
  Corrected in writing so the feature is justified by AOV and conversion, which is what it actually delivers;
  the owner should confirm they still want it on that basis.

## Migration Plan

1. **Owner approves this design.** *Gate — no child ticket is opened before it.*
2. Ticket A — schema, kernel, allocation, validation, photographer-facing configuration. Ships **dark**: no
   checkout reads the kernel, so setting tiers changes nothing a buyer sees or pays.
3. Ticket B — buyer-facing: cart disclosure, both checkouts price and allocate, webhook reads the allocation.
   This is the deploy where money changes; `/code-review ultra` is mandatory.
4. Ticket C — photographer-facing truth: earnings and sales report the discounted gross, with copy explaining
   that the discount is theirs.
5. **Rollout:** enable on one real event and verify one real bundled sale end to end — cart total, Stripe
   receipt, order rows, transfer amount, earnings row — before publicising the feature.
6. **Rollback:** flip the disable constant (immediate, no data change), or revert the ticket-B commit.
   Historical orders are never re-priced.

## Open Questions

- **Tier shape in the UI:** how many tiers to allow (2 or 3 is likely enough) and whether the form should
  suggest a starting schedule derived from `price_per_photo`. Deferred to ticket A, where the form is built.
- **Does the "all my photos" framing need a dynamic count?** This design lets a photographer approximate it
  with a high threshold (e.g. "6+ photos: €19.90"), which covers the Sportograf headline without a
  face-match-defined set. Whether buyers need a literal "all N of your matches" price is a product question to
  revisit after the first real bundled sales — and it depends on the deferred "add all my matches" control.
- **Guest carts spanning events** already work; whether the next-tier nudge should be shown per event group or
  only for the largest group is a UX call for ticket B.
