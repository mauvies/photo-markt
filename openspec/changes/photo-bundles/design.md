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

**D2 — The schedule is a LADDER of `{ minQuantity, totalPriceCents }` rungs, and the applicable rung is the
HIGHEST threshold reached.**

```
rung  = the tier with the greatest minQuantity ≤ quantity, if any
price = rung ? min(quantity × unitPriceCents, rung.totalPriceCents)
             : quantity × unitPriceCents
```

Any number of rungs is supported, which is what makes "1 photo €5 · 3+ photos €12 · 8+ photos €20" expressible
as one schedule.

⚠️ **This corrects an earlier draft of this decision**, which took the `min` across *every* tier whose threshold
was met. That is right for two rungs and wrong for three: the cheapest rung then dominates every rung above it,
so in the ladder above **nobody would ever pay €20** — a buyer taking 20 photos would be charged €12, because
the 3+ rung is also "applicable" and cheaper. Selecting the highest threshold reached fixes it, paired with a
validation rule (D4) that totals **strictly increase** with threshold so every rung is reachable.

The resulting price is **non-decreasing in quantity**, which is worth stating because it is not obvious: inside
a rung's band the price is `min(qty × unit, rungTotal)` and `qty × unit` only grows; at a crossing the rung
total steps up by construction. So adding a photo never makes the cart cheaper, and the ladder can be presented
to the buyer as a simple table.

Alternatives considered: percent-off rungs (`{minQty, percentOff}`) — harder for a buyer to reason about, and
the floor rule gets awkward because the total is derived rather than stated; an explicit price-per-count table —
verbose and unbounded. Flat totals give the Sportograf headline ("all your photos: €20"), and the `min` against
the singles price means no configuration, however wrong, can charge more than buying one at a time.

**D3 — One calc point, client-safe, mirroring `getBuyerServiceFeeCents`.** `src/lib/bundle-pricing.ts` imports
nothing server-only, so the cart can display the price the checkout will charge. This is the property that
makes displayed-vs-charged divergence structurally impossible rather than test-enforced, and it is the reason
`plans.ts` was deliberately kept free of `env.mjs` in T-195.

**D4 — The photographer sets the rungs; the platform does not.** A platform-wide discount schedule would cut a
photographer's revenue on their own goods without their consent. The platform's interest (higher AOV) is served
by *any* bundle, whoever authored it, so there is nothing to gain by taking the decision away. Validation is
enforced at write time in both event actions — the `isPhotoPriceAboveFloor` pattern — rather than as a DB
constraint, so a later-tightened rule never breaks an event that is already selling.

The rule that **totals must strictly increase with threshold** is load-bearing rather than cosmetic: without it
a ladder silently collapses to its cheapest rung (D2). It is enforced at write time and re-checked on read, so
a schedule that violates it can never be created *and* an older one can never mis-price.

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

**D15 — The ladder is shown everywhere the unit price is shown today, and that set is enumerated, not left to
the implementer.** A volume price the buyer only discovers in the cart is a discount that does not convert —
the whole point is that they decide to take more photos *while browsing*. Every surface that renders
`price_per_photo` today is therefore in scope, and the inventory below is the checklist (it is the grep for
`price_per_photo` / `pricePerPhoto`, filtered to render paths):

*Buyer-facing*
- `src/components/event-meta-line.tsx` — the "date · city · photographer · price" line, used by event cards and
  by both event pages. This is the widest-reach surface: it needs a compact form ("€5/photo · packs from €12"),
  not the full table.
- `src/app/[lang]/events/[shareCode]/page.tsx` — the public event page: the price block, and the schema.org
  `offers` JSON-LD, which today emits a single offer and should emit the ladder.
- `src/app/[lang]/dashboard/talent/events/[id]/page.tsx` — the talent-dashboard view of the same event; it must
  match the public page or the same event quotes two prices.
- `src/components/photo-detail-modal.tsx` and `src/components/photo-album-viewer.tsx` — the price sits directly
  above the add-to-cart button, which is the highest-intent moment to mention the pack.
- `src/components/photo-selection-toolbar.tsx` — with N photos selected, this is where the running bundle price
  and the next rung belong (see D16).
- `src/components/cart-totals.tsx` and both carts — already covered by D10.
- Talent orders history and the guest success page / purchase email — these render *paid* amounts, which are
  the allocated per-photo amounts (D8), so they need no bundle concept, only a check that they still read
  correctly when the amounts are not the list price.

*Photographer-facing*
- `src/app/[lang]/dashboard/photographer/events/new/steps/step-3-details.tsx` — where the price is configured in
  the create wizard; the ladder editor lives beside it.
- `src/app/[lang]/dashboard/photographer/events/new/steps/step-5-review.tsx` — the review step must show the
  ladder, or the photographer confirms a price they were never shown.
- `.../events/[id]/edit/` — `event-form-fields.tsx`, `edit-event-form.tsx`, `edit-event-schema.ts`,
  `event-form-data.ts`: the wizard/whole-event edit path, which must accept and clear a ladder.
- `src/app/[lang]/dashboard/photographer/events/[id]/page.tsx` and its **`Pricing` top-level tab** (D17).

⚠️ **Correction to an earlier draft of this decision**, which said "do not add a top-level Pricing tab" on the
premise that the page's top-level tabs did not exist yet and that **T-178** (which introduces them) was a future
ticket to coordinate with. That premise was wrong on inspection of the current source: **T-178 already
shipped** (PR #238, merged) — `dashboard/photographer/events/[id]/page.tsx` already has three top-level tabs,
**Photos / Details / Share**, via `EventTabs` (`event-tabs.tsx`) and `EventTab` (`event-tab.ts`). What I had
mis-cited as "the page's tabs" (`event-moderation-tabs.tsx`, `all`/`pending`) is a *different*, narrower thing:
an inner tab switcher nested **inside** the Photos tab, for moderation queues on collaborative/organizer events.
The two are unrelated axes and neither blocks the other. D17 corrects the plan on this basis.

**D17 — A `Pricing` top-level tab on the photographer's event page, positioned left of `Share`; a matching
dedicated section on the buyer-facing event views.**

*Photographer side.* `EventTab` (`event-tab.ts`) extends from `'photos' | 'details' | 'share'` to
`'photos' | 'details' | 'pricing' | 'share'`; `parseEventTab` and `EventTabs` (`event-tabs.tsx`) add the fourth
trigger/content pair in that order — `Photos · Details · Pricing · Share`. The tab renders a read-only summary
(unit price, and the ladder as a small table: threshold → total → effective per-photo price) plus an **Edit
pricing** button.

That button follows the exact pattern `Details` already established for `info`/`settings` (T-179): the edit
route gains a third scoped section, `ScopedSection` in `scoped-event-edit-form.tsx` becomes
`'info' | 'settings' | 'pricing'`, `parseSection` (`edit/page.tsx`) accepts it, and `?section=pricing` renders
just the ladder editor — not the whole event form, and not bundled into `info` (which is date/location/activity
and does not belong in a change this order of complexity). This keeps T-178's decision intact: **`/edit` stays
the only place a field is actually written**; the tab is display plus a link, exactly like `Details` is today.

Rejected alternative: making the Pricing tab itself editable in place. Every other top-level tab is read-only
with a link out — introducing the one exception here would be inconsistent for no benefit, since the scoped-edit
pattern already gives a focused single-purpose form without the whole-event page's photo/cover UI.

*Buyer side.* Neither buyer-facing event view is tabbed — the public page (`events/[shareCode]/page.tsx`) and
the talent-dashboard view (`dashboard/talent/events/[id]/page.tsx`) are both a single scroll: header → meta line
→ (contribute affordance) → gallery. A ladder is more information than the compact meta line can carry (D15
already scopes the meta line to a compact hint), so it needs its own place, not a wider meta line.

New shared component `src/components/event-pricing-section.tsx`: a `Card`-based panel (reusing the existing
shadcn `Card`, matching the visual language of other event-page cards rather than introducing a new UI
pattern) showing the unit price and the ladder table, or nothing beyond the unit price when there is no ladder
— so an unbundled event's page looks exactly as it does today. Mounted at one shared position on both surfaces:
directly under `EventMetaLine`, above the gallery/contribute affordances — the same slot on both, so the two
views don't drift (the repeated pattern from T-103/T-082/T-186: one component, mounted at the same place on
both surfaces, so neither can quietly diverge from the other).

**D16 — "Buy all my photos" needs one button, and the plumbing already exists.** A ladder alone does not deliver
the Sportograf promise: the buyer must be able to act on "all of mine" without ticking twenty checkboxes. Both
gallery viewers already have multi-select and a working bulk add-to-cart (`PhotoSelectionToolbar` +
`handleBulkAddToCart` on the public and talent viewers), so the missing piece is a single "add all my matches"
action after a face search — not new infrastructure.

This was initially deferred as a follow-up. It is pulled into scope because without it the feature reads as a
discount rather than as a product, which is not what was asked for. The security constraint from D7 stands and
decides where the ids come from: on a **non-gated** event the client already holds the matched ids from the
search it just ran, so the action is client-side over ids the buyer legitimately has; on a **gated** event it
MUST take the server's proven set (`getProvenRevealIds`) and never a fresh query. Both paths still add
individual photos to the cart — no new entitlement, per D1.

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

- **How many rungs to allow.** Three or four covers "single · small pack · all of them" with room to spare, and
  a cap keeps the ladder readable on a card and in the meta line. The exact number is a ticket-A call once the
  editor exists.
- **Whether the ladder editor should suggest a starting schedule** derived from `price_per_photo` (e.g. 3 for
  the price of 2.4). Useful, but it is the platform recommending a price cut, so it must read as a suggestion.
- **"All my photos" is priced as a high rung, not as a literal match count.** "8+ photos: €20" delivers the
  headline for anyone with 8 or more matches, and D16 gives them the one-click way to take them. A literal
  "all N of *your* matches for €X" would make the price depend on a probabilistic face-match count — including
  false positives at the 80 threshold, which the buyer would be paying for. Revisit only if real buyers ask.
- **Guest carts spanning events** already work; whether the next-rung prompt should be shown per event group or
  only for the largest group is a UX call for ticket B.
