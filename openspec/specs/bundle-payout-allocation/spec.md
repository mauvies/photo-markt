# bundle-payout-allocation Specification

## Purpose

Keep one number — the money the buyer actually paid — flowing unchanged through every downstream surface of a
discounted sale: the Stripe session, the order rows, the photographer's transfer, and the Sales and Earnings
tabs. A bundle discounts a **set**, but the purchasable unit is the photo, so the total has to be split across
photos exactly and then never re-derived. The repo has already been bitten by two independent derivations of
one figure disagreeing by a cent (T-197); here the same class of error would mean transferring money that was
never collected, or reporting a balance that can never be withdrawn.

## Requirements

### Requirement: A discounted total is allocated to per-photo amounts that sum to it exactly

When a `(event, photographer)` group is priced by a bundle tier, the discounted total MUST be allocated across
the group's photos as whole cents that sum to the total **exactly**, with no remainder discarded and none
invented. Allocation MUST use a deterministic largest-remainder rule so the same set always produces the same
per-photo amounts.

#### Scenario: Allocation of an indivisible total loses no cent
- **WHEN** a 3-photo group is priced at 1000 cents
- **THEN** the allocated amounts are 334, 333, 333 (or another deterministic permutation) and sum to exactly
  1000

#### Scenario: Undiscounted groups keep their list price
- **WHEN** a cart holds photos from two events and only one of them qualifies for a tier
- **THEN** only that event's photos are re-priced by allocation; the other event's photos keep
  `price_per_photo` as their amount

### Requirement: Every money surface is built from the allocated amounts

Every money surface MUST be derived from the allocated per-photo amounts — never from the undiscounted list
price, and never from a second computation of the bundle total. That covers the Stripe line items, the
`orders` / `guest_orders` totals, the `order_items` / `guest_order_items` rows, the photographer transfer, and
the earnings and sales views.

Building the session's line items from the same allocation makes the charged total equal the sum of the order
rows **by construction**, which is a stronger guarantee than any assertion could be. The existing rule that the
photographer's commission is derived as `gross − getPhotographerNetCents(gross)` is unchanged; `gross` simply
becomes the allocated (charged) amount, so `gross = commission + net` stays true on a discounted sale.

#### Scenario: The transfer reflects money actually collected
- **WHEN** 8 photos listing at €24.00 are sold as a €19.90 bundle by a Free-plan photographer (8% commission)
- **THEN** the order rows total 1990 cents, the transfer is `getPhotographerNetCents(1990, 'free')`, and no
  path transfers or reports against 2400

#### Scenario: Earnings and sales agree on a discounted sale
- **WHEN** the photographer views that sale in the Sales tab and in the Earnings tab
- **THEN** both report the same gross (1990), the same commission (`1990 − net`), and the same net

#### Scenario: The buyer's receipt totals the same as the order
- **WHEN** the checkout session is created for that bundle
- **THEN** the sum of the photo line items equals 1990, plus exactly one service-fee line item, and the
  session total equals what the cart displayed

### Requirement: One derivation, shared by both reporting tabs

The per-sale commission and net MUST be produced by exactly one pair of functions
(`calculatePlatformFee` / `calculateNetEarnings`), called by both the Sales tab and the Earnings tab. Neither
tab MAY inline its own copy of the formula, even a copy that currently agrees: "both tabs report the same
breakdown" has to be true by construction, which is precisely the property T-197 was created to establish.

#### Scenario: One sale, one breakdown
- **WHEN** the same bundled sale is rendered in both tabs
- **THEN** the gross, commission and net shown are identical, because both were produced by the same call

### Requirement: Reported earnings totals equal the payouts actually transferred

Aggregate earnings figures MUST be netted per **order** — `getPhotographerNetCents` applied to each order's
gross and summed — because that is the unit the money moves in: the webhook creates one transfer per
`(order, photographer)`.

They MUST NOT be netted over a period's combined gross. `getPhotographerNetCents` floors, and a sum of floors
is not the floor of a sum, so period-level netting reports up to a cent per order more than was ever
transferred — which surfaces as a withdrawable balance the photographer can see and never withdraw. Bundle
allocations make the drift likelier, not rarer: an allocated share lands on arbitrary cents far more often
than a list price does.

The per-row breakdown stays per line item (that is what keeps the two tabs identical), so a multi-item order's
rows MAY sum to a cent under its payout. That is a display artefact of the per-photo split, not a discrepancy
in the balance.

#### Scenario: A mixed period reconciles with the transfers
- **WHEN** a period contains one bundled order and one single sale, each grossing 513 cents
- **THEN** the reported net is `2 × getPhotographerNetCents(513)` = 942, matching the two transfers, rather
  than `getPhotographerNetCents(1026)` = 943

#### Scenario: The breakdown still adds up
- **WHEN** any set of orders is aggregated for any plan
- **THEN** `gross = commission + net`, with the commission derived as the remainder rather than independently
  rounded

### Requirement: A bundle discount is explained as the photographer's own price reduction

Both tabs MUST state what a bundle discount is: the photographer's own price reduction, not a platform
deduction, and unrelated to the buyer service fee. Because a bundled sale reports the charged amount, their
figures are lower than the list total by the discount they themselves set, and an unexplained gap invites
exactly those two wrong readings.

The explanation MUST NOT be shown to a photographer who has no volume pricing configured — the same rule that
keeps the buyer-fee note silent while no fee is charged. The check for it MUST fail closed (no note), because
a reporting footnote may never break the money views.

#### Scenario: The note appears only where it applies
- **WHEN** a photographer with no ladder or cap on any event opens either tab
- **THEN** no bundle-discount explanation is rendered

### Requirement: The webhook reads the allocation checkout committed and never recomputes a price

Checkout MUST commit the allocation before creating the Stripe session, and the webhook MUST read it:
- the guest flow carries each photo's allocated amount in the per-item checkout metadata it already writes
  (the `c` field of `cart_<i>`), so no new mechanism is introduced;
- the authenticated flow persists it on the cart row (`cart_items.allocated_price_cents`, nullable), which the
  webhook prefers over `unit_price_cents` when present.

Only **discounted** groups may be written, so a null keeps meaning "no bundle applied" and an unbundled cart
provably takes the pre-bundle path. Writing an allocation MUST first clear any other allocation on the cart, so
a 5-photo bundle's split cannot survive into a later 2-photo checkout.

The webhook MUST NOT re-derive a bundle price from the event's tiers. Tiers are photographer-editable at any
moment, so a recomputation between charge and delivery would create an order that disagrees with the card
statement. This extends the existing invariant that the webhook rebuilds orders from cart metadata and
`cart_items` rows and never from `session.line_items`.

#### Scenario: Editing tiers mid-flight cannot change a completed order
- **WHEN** the photographer changes the event's tiers between the checkout session being created and the
  webhook arriving
- **THEN** the order rows and the transfer use the amounts committed at checkout, matching what the buyer was
  charged

#### Scenario: A session without an allocation behaves as before
- **WHEN** the webhook processes a session whose items carry no allocated amount (an event with no tiers, or a
  session created before this change)
- **THEN** it falls back to `unit_price_cents` and produces exactly the order it produces today

### Requirement: Photos already bought are excluded and earn no retroactive credit

Photos the buyer already owns MUST NOT be re-sold, and MUST NOT count toward a tier threshold. The quantity
that decides the tier is the quantity being bought in this checkout.

There is deliberately no retroactive credit for a buyer who bought singles before reaching a tier. Granting one
would require either a partial refund — which in this system does not automatically reverse the photographer's
transfer — or a discount funded by a platform that holds close to zero per-sale margin by design. The residual
unfairness is accepted and mitigated by disclosure: the cart advertises the next tier while the cart is still
small, which is where the buyer can still act on it.

#### Scenario: Prior purchases do not count toward a threshold
- **WHEN** a buyer already owns 3 photos from an event and adds 5 more, with a tier at 8
- **THEN** the tier does not apply, the 5 photos are priced at `5 × unit`, and no credit for the earlier
  purchase is applied

#### Scenario: A refund is unaffected by bundling
- **WHEN** a bundled order is refunded
- **THEN** the refund path behaves exactly as it does for an unbundled order of the same total, including the
  existing manual transfer-reversal caveat
