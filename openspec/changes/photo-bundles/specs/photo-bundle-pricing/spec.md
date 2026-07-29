## ADDED Requirements

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
`getBundlePriceCents(quantity, unitPriceCents, tiers)` in `src/lib/bundle-pricing.ts`, defined as:

```
getBundlePriceCents = min( quantity × unitPriceCents,
                           min over tiers where minQuantity ≤ quantity of tier.totalPriceCents )
```

Taking the minimum against `quantity × unitPriceCents` makes it structurally impossible for a tier to charge
*more* than buying the same photos singly, whatever the configured values. The module MUST be client-safe (no
`env.mjs`, no server-only import) so the cart displays the price from the same function the checkout charges
from — the disclosure property billing v2 established for the service fee. No cart, checkout, webhook or
earnings path MAY re-derive a discount inline.

#### Scenario: The applicable tier replaces the per-unit total
- **WHEN** the schedule is `[{ minQuantity: 5, totalPriceCents: 1200 }, { minQuantity: 8, totalPriceCents: 1990 }]`,
  the unit price is €3.00, and the cart holds 8 photos
- **THEN** `getBundlePriceCents` returns 1200 — the cheapest total among tiers whose threshold is met, not
  merely the highest tier reached

#### Scenario: Below the first threshold nothing is discounted
- **WHEN** the same schedule applies and the cart holds 3 photos
- **THEN** the price is 900 (3 × €3.00), no discount line is shown, and the checkout session is identical to
  one built without any schedule

#### Scenario: A misconfigured tier can never overcharge
- **WHEN** a tier's total exceeds `quantity × unitPriceCents` for the quantity in the cart
- **THEN** the function returns `quantity × unitPriceCents`, so the buyer never pays more than the sum of
  singles

### Requirement: An unreadable schedule fails closed to undiscounted pricing

Tiers are persisted as JSON. Every read path MUST parse defensively and, on anything it cannot validate
(malformed JSON, wrong shape, negative or non-integer amounts, unsorted or duplicate thresholds), MUST behave
as if the event had no tiers.

Failing closed here means falling back to `quantity × unitPriceCents`. That direction is deliberate: it can
only ever *overcharge relative to the photographer's intent*, which is visible and refundable, never
*undercharge*, which silently moves money the platform cannot recover.

#### Scenario: Corrupt tier data does not produce a wrong price
- **WHEN** an event's stored tiers cannot be parsed or validated
- **THEN** the cart, the checkout and the photographer's earnings all price the set at `quantity × unit`, and
  no discount line is displayed

### Requirement: The photographer sets the tiers, per event, within validated bounds

The bundle schedule MUST be set by the event's owner in the event create and edit forms; the platform MUST NOT
impose a discount schedule of its own. Validation MUST be enforced at write time in both event actions (the
`isPhotoPriceAboveFloor` pattern — an app-level rule, not a database constraint), so an event configured under
an older rule keeps working until its schedule is next written.

A schedule is valid only when all of the following hold:
- every `minQuantity` is an integer ≥ 2, and thresholds are strictly increasing with no duplicates;
- every `totalPriceCents` is a positive integer;
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

#### Scenario: Organizer events cannot configure a bundle
- **WHEN** an event of type `organizer` is created or edited with bundle tiers
- **THEN** the action rejects the schedule, and the bundle fields are not offered in that event's form

#### Scenario: Pricing is grouped by seller
- **WHEN** a cart contains photos from one eligible event
- **THEN** the quantity that decides the tier is the number of photos in that `(event, photographer)` group,
  not the total number of items in the cart across events

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

### Requirement: Bundles never expose a photo the buyer has not been shown

Bundle affordances MUST NOT enumerate, price, or add to a cart any photo the buyer has not already been shown
through the normal listing paths. Specifically, there MUST be no "buy the whole event" control and no
server-side expansion of a set from anything other than ids already in the buyer's possession.

This is what keeps the reveal gate intact: on a gated event photo ids reach only a visitor who has proven a
face match, and because a bundle is a price applied to the cart rather than an event-wide product, there is
nothing for an unproven visitor to buy and nothing to unlock. A future "add all my matches to cart" control
MUST derive its ids from the reveal-gate proven set, never from a fresh server-side query.

#### Scenario: A gated event offers no whole-event purchase
- **WHEN** a visitor who has not proven a face match views a reveal-gated event that has bundle tiers
- **THEN** no photo ids or prices for unrevealed photos are served, and no control offers to buy the event's
  photos as a set

### Requirement: Volume pricing is globally disable-able

A single constant MUST disable the kernel, making `getBundlePriceCents` return `quantity × unitPriceCents` for
every event regardless of stored tiers, and suppressing every bundle affordance and discount line. Stored
schedules MUST survive being disabled — they are simply not read — so rollback is a one-line revert with no
data migration and no repricing of historical orders.

#### Scenario: Disabling reproduces pre-bundle behaviour
- **WHEN** the constant is set to disabled while events hold configured tiers
- **THEN** every cart prices at `quantity × unit`, no discount line renders, and checkout sessions are
  identical to those built before this change
