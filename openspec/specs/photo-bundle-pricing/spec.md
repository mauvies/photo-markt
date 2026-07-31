# photo-bundle-pricing Specification

## Purpose

Let a photographer sell photos by the pack — "3+ for €12", "all of them for €19.90" — the way Sportograf's
Foto-Flat does, without introducing a second kind of thing to buy. A bundle is a **price**, not a product: the
purchasable unit stays the individual photo, so every entitlement reader, the reveal gate and the download
paths keep working untouched, and rollback is a constant flip with no data migration.

## Requirements

### Requirement: A bundle is a price schedule on the event, never a separate purchasable item

Volume pricing MUST be expressed as an optional ordered list of tiers stored on the event, each tier being
`{ minQuantity, totalPriceCents }` — "this many photos or more, for this flat total". The purchasable unit MUST
remain the individual photo: the cart still holds photo rows, and a completed purchase still produces one
`order_items` / `guest_order_items` row per photo.

No "bundle" entitlement, no event-wide product, and no order row that means "owns event E" MAY be introduced.
Every existing entitlement reader — talent library, orders history, the ZIP download route, the guest
download-token page, the sold-photo soft-delete predicate — MUST continue to work unchanged, because what they
read is unchanged.

#### Scenario: A bundle purchase yields per-photo entitlements
- **WHEN** a buyer checks out 8 photos from an event whose tiers price 8+ at €19.90
- **THEN** the completed order contains 8 per-photo item rows (not one bundle row), and every download and
  library surface treats those 8 photos exactly as it treats individually-bought photos

#### Scenario: An event with no tiers is unchanged
- **WHEN** an event has no bundle tiers configured
- **THEN** the cart, the checkout session, the order rows and the photographer's payout are byte-identical to
  the behaviour before this change

### Requirement: The bundle price is computed in a single place

The discounted price of a set MUST be computed by exactly one function,
`getBundlePriceCents(quantity, unitPriceCents, tiers, allPhotosCents?)` in `src/lib/bundle-pricing.ts`, defined
as:

```
rung  = the tier with the GREATEST minQuantity ≤ quantity, if any
price = min(quantity × unitPriceCents,
            rung ? rung.totalPriceCents : ∞,
            allPhotosCents ?? ∞)
```

The schedule is a **ladder** and MUST support any number of rungs, so a photographer can express
"1 photo €5 · 3+ photos €12 · 8+ photos €20" as one schedule. The applicable rung MUST be the highest threshold
reached — **not** the cheapest rung whose threshold is met, which would make every rung above the cheapest one
unreachable and let a 20-photo buyer pay the 3-photo price.

Taking the minimum against `quantity × unitPriceCents` makes it structurally impossible for a rung to charge
*more* than buying the same photos singly, whatever the configured values. The module MUST be client-safe (no
`env.mjs`, no server-only import) so the cart displays the price from the same function the checkout charges
from — the disclosure property billing v2 established for the service fee. No cart, checkout, webhook or
earnings path MAY re-derive a discount inline.

#### Scenario: A three-rung ladder charges each rung
- **WHEN** the unit price is €5.00 and the schedule is
  `[{ minQuantity: 3, totalPriceCents: 1200 }, { minQuantity: 8, totalPriceCents: 2000 }]`
- **THEN** 1 photo costs 500, 2 cost 1000, 3 cost 1200, 7 cost 1200, 8 cost 2000 and 20 cost 2000 — each rung is
  reachable, and the 8+ rung is not shadowed by the cheaper 3+ rung

#### Scenario: Below the first threshold nothing is discounted
- **WHEN** the same schedule applies and the cart holds 2 photos
- **THEN** the price is 1000 (2 × €5.00), no discount line is shown, and the checkout session is identical to
  one built without any schedule

#### Scenario: A misconfigured rung can never overcharge
- **WHEN** a rung's total exceeds `quantity × unitPriceCents` for the quantity in the cart
- **THEN** the function returns `quantity × unitPriceCents`, so the buyer never pays more than the sum of
  singles

### Requirement: The price is not monotonic in quantity, and MUST NOT be forced to be

A smaller set MAY cost more than a larger one, and no validation rule MUST be added to forbid it. "3 for €9" at €5/photo
charges €10 for two photos and €9 for three — that is what a volume discount IS, and the flagship Foto-Flat
shape ("40 for €19.90" at €4.88/photo) is the same property taken to its limit: any rule strong enough to
forbid the first forbids the second.

(This supersedes an earlier "price never decreases as photos are added" scenario in the change's delta spec,
corrected in T-212.) The buyer's protection is the `min` against singles — they can never pay more than buying
the same photos one by one — not monotonicity across different set sizes.

#### Scenario: A deep pack prices a smaller set higher
- **WHEN** the unit price is €5.00 and the schedule is `[{ minQuantity: 3, totalPriceCents: 900 }]`
- **THEN** 2 photos cost 1000 and 3 photos cost 900, and this is accepted at write time

### Requirement: An "all photos" price is a ceiling, not a rung

An event MAY additionally carry `bundle_all_photos_cents` — "every photo of mine for this price" — which MUST
be applied as a **ceiling** over the whole calculation rather than as another rung: it engages exactly where
`quantity × unitPriceCents` would exceed it, so a buyer with 3 matches still pays per photo while a buyer with
40 pays the flat price.

A ceiling rather than a threshold rung, because a rung would force the photographer to derive the threshold
(`ceil(cap / price_per_photo)`), and that derived number **goes stale when the unit price changes**: a rung at
"4+ for €20" silently stops applying if the price drops to €4, with nobody told. The cap keeps meaning what was
typed. It is independent of the ladder — a cap with no rungs is a complete configuration.

The cap MUST be at least `MIN_PHOTO_PRICE_CENTS`, strictly above the unit price (at or below it the per-photo
price is unreachable), and strictly above every rung total (a rung at or above the cap can never apply, so it
is dead configuration).

#### Scenario: The cap engages only where it beats the ladder
- **WHEN** the unit price is €5.00, a rung prices 3+ at €12.00 and the cap is €20.00
- **THEN** 2 photos cost 1000, 3 cost 1200, 5 cost 1200, and 40 cost 2000

#### Scenario: Reaching the cap makes the remaining photos free
- **WHEN** a buyer holding the capped set adds one more photo
- **THEN** the total does not change — that is the Foto-Flat bargain, not a defect

### Requirement: An unreadable schedule fails closed on READ and rejects the save on WRITE

Tiers are persisted as JSON, so the direction of failure MUST differ by path:

- **Reads** MUST parse defensively and, on anything they cannot validate (malformed JSON, wrong shape, negative
  or non-integer amounts, unsorted or duplicate thresholds), behave as if the event had no tiers — falling back
  to `quantity × unitPriceCents`. That direction can only ever *overcharge relative to the photographer's
  intent*, which is visible and refundable, never *undercharge*, which silently moves money the platform cannot
  recover.
- **Writes** MUST distinguish **three** submission states, never collapse them into one null: `absent` (the form
  never carried the field ⇒ leave the stored value untouched), `cleared` (explicitly emptied ⇒ write null), and
  `invalid` (⇒ reject the save and name the reason ⇒ never write). Collapsing them was silent data loss on a
  money column: a cleared amount box, a `1` typed into a threshold, or a stored ladder the reader rejects each
  DELETED the photographer's pricing and reported success (T-212).

Only a form that renders the ladder editor MAY submit the field, so a scoped edit section that cannot show
pricing can neither wipe it nor be rejected because of it.

#### Scenario: Corrupt tier data does not produce a wrong price
- **WHEN** an event's stored tiers cannot be parsed or validated
- **THEN** the cart, the checkout and the photographer's earnings all price the set at `quantity × unit`, and
  no discount line is displayed

#### Scenario: An unrelated save does not erase a stored ladder
- **WHEN** the owner saves a scoped edit section that does not render the pricing editor
- **THEN** the stored ladder and cap are left exactly as they were

#### Scenario: An invalid ladder is rejected, not silently dropped
- **WHEN** the owner submits a threshold of 1 in the pricing editor
- **THEN** the save is rejected with the reason, and the previously stored ladder remains intact

### Requirement: The photographer sets the tiers, per event, within validated bounds

The bundle schedule MUST be set by the event's owner in the event create and edit forms; the platform MUST NOT
impose a discount schedule of its own. Validation MUST be enforced at write time in both event actions (the
`isPhotoPriceAboveFloor` pattern — an app-level rule, not a database constraint), so an event configured under
an older rule keeps working until its schedule is next written.

A schedule is valid only when all of the following hold:
- every `minQuantity` is an integer ≥ 2, and thresholds are strictly increasing with no duplicates;
- every `totalPriceCents` is a positive integer;
- `totalPriceCents` **strictly increases** with `minQuantity` — a higher rung must cost more than a lower one.
  This is not cosmetic: without it a ladder collapses, because a cheap high rung would price every quantity
  above its threshold below the rung the photographer intended;
- every `totalPriceCents` is **at least `MIN_PHOTO_PRICE_CENTS`** — the same constant the per-photo floor uses,
  applied to the bundle *total*, because the floor exists so the fixed part of the service fee is never
  disproportionate to what is being bought, and for a bundle the thing being bought is the set;
- every `totalPriceCents` is **strictly less than `minQuantity × price_per_photo`**, so a tier that is not
  actually a discount cannot be saved;
- the number of tiers does not exceed a small fixed cap.

#### Scenario: A tier below the floor is rejected at write time
- **WHEN** an event owner saves a tier whose total is under `MIN_PHOTO_PRICE_CENTS`
- **THEN** the action rejects the save, no row is created or mutated, and the reason reaches the client through
  the same parseable-sentinel channel `MIN_PHOTO_PRICE:<cents>` uses

#### Scenario: A tier that is not a discount is rejected
- **WHEN** the unit price is €3.00 and the owner saves `{ minQuantity: 5, totalPriceCents: 1500 }`
- **THEN** the action rejects it, because 5 × €3.00 = €15.00 is not more than the tier total and the tier would
  never apply

#### Scenario: A ladder whose totals do not increase is rejected
- **WHEN** the owner saves `[{ minQuantity: 3, totalPriceCents: 2000 }, { minQuantity: 8, totalPriceCents: 1200 }]`
- **THEN** the action rejects it, because the 8+ rung is cheaper than the 3+ rung and every quantity from 3
  upward would be priced by a rung the owner did not intend

#### Scenario: Existing events are not retroactively invalidated
- **WHEN** the floor or the validation rules are later tightened
- **THEN** events whose stored schedule no longer satisfies them keep selling at that schedule until their
  schedule is next written, and only the write is rejected

### Requirement: Bundles apply only to events with a single seller

A bundle MUST only be configurable and applicable on events whose photos all belong to one photographer —
`events.type` of `solo` or `collaborative`, where every `photos.user_id` is the event owner by construction
(`uploadGuestPhoto` assigns the owner's id to guest contributions).

Organizer events MUST be excluded. There, an accepted contributor's uploads carry that contributor's
`photos.user_id`, so one event's cart can span several sellers, and a discount set by the organizer would cut
another photographer's revenue without their consent. Organizer revenue sharing does not exist yet —
`organizer_fee_per_photo_cents` is written at event creation and read by no money path — so there is nothing to
split a bundle discount against.

The pricing kernel MUST nonetheless be applied per `(event, photographer)` group rather than per event, so that
the day organizer revenue sharing exists, enabling bundles there is a gate change and not a repricing redesign.

An event that becomes ineligible (its price is removed, or the feature is switched off) MUST **keep** its stored
schedule — it simply cannot apply — so restoring a price restores the packs. Write-path eligibility MUST be
decided without folding in the global kill switch, or flipping the switch for a rollback would make the next
save of any kind erase every stored ladder permanently.

#### Scenario: Organizer events cannot configure a bundle
- **WHEN** an event of type `organizer` is created or edited with bundle tiers
- **THEN** the action rejects the schedule, and the bundle fields are not offered in that event's form

#### Scenario: Pricing is grouped by seller
- **WHEN** a cart contains photos from one eligible event
- **THEN** the quantity that decides the tier is the number of photos in that `(event, photographer)` group,
  not the total number of items in the cart across events

#### Scenario: A cart spanning two events discounts only the qualifying group
- **WHEN** a cart holds photos from two events and only one qualifies for a rung
- **THEN** only that group is discounted; the other event's photos keep their list price, so no photographer's
  revenue funds another's discount

### Requirement: Cart pricing fails closed to list price when the group is ambiguous

Cart-level pricing MUST happen in exactly one place (`priceCartWithBundles`), used by both checkouts, both cart
views — including a cart's optimistic re-price after a removal — and the selection toolbar, so what is displayed
and what is charged cannot diverge.

It MUST fall back to list price when the event is ineligible, has no schedule, has no resolvable event id, or
when a group's lines **disagree on the unit price** (a price change between two adds makes `quantity × unit`
ill-defined). That direction can only overcharge versus intent, never undercharge.

#### Scenario: A stale unit price disables the discount rather than guessing
- **WHEN** two cart lines from the same event carry different `unit_price_cents`
- **THEN** the group is priced at the sum of its line prices and no discount line is shown

### Requirement: The buyer service fee is computed on the post-discount subtotal

The buyer service fee MUST be `getBuyerServiceFeeCents` of the subtotal **after** any bundle discount, and MUST
remain a single fee per checkout session regardless of how many photos or bundles it contains. The service-fee
capability is specified over "the validated cart subtotal", and under a bundle the validated subtotal is the
discounted total — this requirement states that explicitly so the two cannot be read as conflicting.

#### Scenario: Fee follows the discounted subtotal
- **WHEN** 8 photos listing at €24.00 are priced by a tier at €19.90
- **THEN** the service fee is `getBuyerServiceFeeCents(1990)`, not `getBuyerServiceFeeCents(2400)`, and exactly
  one fee line item appears in the session

### Requirement: The discount and the resulting total are disclosed before checkout

The cart MUST show the undiscounted subtotal, the bundle discount as its own labelled line, the service fee,
and the total — all before the buyer reaches Stripe, through the shared `CartTotals` component so the guest and
authenticated carts (desktop and mobile) cannot drift apart. When no discount applies, the summary MUST render
exactly what it renders today.

The cart MAY additionally show how far the buyer is from the next tier, computed from the same kernel. That
prompt MUST state the resulting price rather than a percentage, and MUST NOT be shown when no further tier
exists.

#### Scenario: Discount is visible up front
- **WHEN** a buyer views a cart that qualifies for a tier
- **THEN** the summary shows subtotal €24.00, bundle discount −€4.10, service fee, and a total equal to their
  sum, before any redirect to Stripe

#### Scenario: The next-tier prompt reflects the real price
- **WHEN** the cart holds 6 photos and the 8-photo tier would cost less than the current 6
- **THEN** the cart may invite the buyer to add 2 more photos and states the resulting total, computed by
  `getBundlePriceCents(8, …)`

### Requirement: Exactly one surface quotes an event's price

Exactly one surface MUST tell an event's whole price story, and no other surface may quote a number that
contradicts it. A price shown without its ladder is a wrong price: it quotes €5 for a photo on an event where
six cost €12. The fix is **not** to repeat the price in more places with a compact ladder appended (tried and
reverted in T-204), but to concentrate it:

- when the event has a schedule, the dedicated `EventPricingSection` — unit price, every rung, and the
  all-photos cap — carries it, and the event meta line **suppresses its price segment entirely**; on an event
  sold by the package the unit price is the least relevant number to lead with;
- when the event has no schedule, the section renders nothing and the meta line keeps the price;
- the section MUST be mounted at the same position on both the public event page and the talent-dashboard event
  view, so the two cannot quietly disagree about the same event's price;
- one-line offer displays on overlays where the section is not visible (purchase modal, selection toolbar) MUST
  go through the shared offer formatter, which quotes the **deepest** offer available (the cap, else the highest
  rung);
- the public event page's schema.org `offers` MUST emit one Offer per rung, and stay a single bare Offer when
  there is no ladder.

Event cards render no price at all and therefore need no ladder (the original delta spec assumed otherwise).

The photographer's create wizard (price step and review step) MUST show the ladder being configured, so nobody
confirms a price they were never shown. The photographer's event detail page MUST expose the ladder through a
**top-level `Pricing` tab**, positioned immediately to the left of the existing `Share` tab (tab order:
`Photos · Details · Pricing · Share`), showing the unit price and the ladder read-only with a link to edit —
mirroring how the existing `Details` tab links to a scoped edit section rather than editing in place.

#### Scenario: The public event page quotes the pack, not just the unit price
- **WHEN** a visitor opens an event priced at €5/photo with a "3+ for €12" rung
- **THEN** the pricing section states the unit price and every pack, and the meta line above it shows no price
  segment at all

#### Scenario: The talent-dashboard view agrees with the public page
- **WHEN** a signed-in talent user views the same event from `/dashboard/talent/events/[id]`
- **THEN** the pricing section in the same position shows the identical ladder

#### Scenario: A configured all-photos price reaches the buyer
- **WHEN** an event carries `bundle_all_photos_cents` but no rungs
- **THEN** the pricing section shows the unit price and the all-photos price, because a Foto-Flat nobody is
  shown is the same wrong-price failure this requirement exists to prevent

#### Scenario: The photographer reviews the ladder before saving
- **WHEN** an owner reaches the create wizard's review step having configured a ladder
- **THEN** the review shows every rung and its effective per-photo price at that threshold

#### Scenario: The photographer inspects and edits pricing from its own tab
- **WHEN** an owner opens their event's detail page
- **THEN** a `Pricing` tab sits between `Details` and `Share`, shows the current ladder read-only, and its edit
  link opens the scoped pricing editor — not the whole-event edit form

### Requirement: Taking every matched photo is a single action

After a face search, the buyer MUST be able to add all of their matched photos to the cart in one action, on
both the public event page and the talent-dashboard event view. Without it, "buy all my photos" is a price the
interface never lets anyone reach; the existing multi-select toolbar and bulk add-to-cart are the mechanism.

The ids for that action MUST come from what the buyer already legitimately holds: the viewer's own match set,
which on a reveal-gated event IS the proven set the reveal token was minted over. A fresh server-side query for
"this event's photos" MUST NOT be used. The action adds individual photos — it MUST NOT create a bundle
entitlement.

#### Scenario: One action takes the whole match set
- **WHEN** a buyer's face search returns 14 matches on an event with an "8+ for €20" rung
- **THEN** a single action adds all 14 photos to the cart, and the cart prices them at €20

#### Scenario: The action cannot widen a gated event's exposure
- **WHEN** the same action runs on a reveal-gated event
- **THEN** it adds only photos in the server's proven reveal set for that visitor, never any other photo of the
  event

### Requirement: Bundles never expose a photo the buyer has not been shown

Bundle affordances MUST NOT enumerate, price, or add to a cart any photo the buyer has not already been shown
through the normal listing paths. Specifically, there MUST be no "buy the whole event" control and no
server-side expansion of a set from anything other than ids already in the buyer's possession.

This is what keeps the reveal gate intact: on a gated event photo ids reach only a visitor who has proven a
face match, and because a bundle is a price applied to the cart rather than an event-wide product, there is
nothing for an unproven visitor to buy and nothing to unlock.

#### Scenario: A gated event offers no whole-event purchase
- **WHEN** a visitor who has not proven a face match views a reveal-gated event that has bundle tiers
- **THEN** no photo ids or prices for unrevealed photos are served, and no control offers to buy the event's
  photos as a set

### Requirement: Volume pricing is globally disable-able

A single constant MUST disable the kernel, making `getBundlePriceCents` return `quantity × unitPriceCents` for
every event regardless of stored tiers, and suppressing every bundle affordance and discount line. Stored
schedules MUST survive being disabled — they are simply not read, and no write path may treat the switch as a
reason to clear them — so rollback is a one-line revert with no data migration and no repricing of historical
orders.

#### Scenario: Disabling reproduces pre-bundle behaviour
- **WHEN** the constant is set to disabled while events hold configured tiers
- **THEN** every cart prices at `quantity × unit`, no discount line renders, and checkout sessions are
  identical to those built before this change

#### Scenario: Rollback is inert
- **WHEN** an event is saved while the constant is disabled
- **THEN** its stored ladder and cap are left untouched, so re-enabling restores the packs exactly
