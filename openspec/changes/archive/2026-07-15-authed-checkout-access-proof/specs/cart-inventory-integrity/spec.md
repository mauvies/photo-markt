## ADDED Requirements

### Requirement: Persisted per-item access proof
The system SHALL persist, on each authenticated `cart_items` row, the share code the caller presented when
the item was added — a nullable `access_share_code` column. `addPhotoToCartAction` (authed add) and
`mergeGuestCartAction` (guest→authed merge) MUST write the presented code into this column; a caller that
presents no code (public event, or the favorites/tag path) MUST store null. The stored value is a captured
proof, never the event's live `share_code` read back through a join.

#### Scenario: Private-event item added with a share code
- **WHEN** a photo from a private event is added to the authenticated cart with the event's matching share code
- **THEN** the new `cart_items` row's `access_share_code` equals that presented code

#### Scenario: Public-event item added with no code
- **WHEN** a photo from a public event is added to the authenticated cart with no share code
- **THEN** the new `cart_items` row's `access_share_code` is null

#### Scenario: Guest item merged carries its proof
- **WHEN** a guest cart item that stored `eventShareCode` at add time is merged into the authenticated cart
- **THEN** the resulting `cart_items` row's `access_share_code` equals that stored code

### Requirement: Accessibility predicate at cart boundaries
The system SHALL define accessibility for an authenticated cart item using the single shared
`isEventAccessible` rule (T-132): the item is accessible iff its event is public now, OR the item's persisted
`access_share_code` matches the event's current `share_code`, OR the buyer still has the photo tagged in their
library (a live check, covering the favorites path that presents no code). There SHALL NOT be a second,
divergent definition of accessibility in the authenticated cart or checkout paths.

#### Scenario: Public event is always accessible
- **WHEN** an item's event has `is_public = true`
- **THEN** the item is accessible regardless of stored code or tag

#### Scenario: Private event with a matching stored code
- **WHEN** an item's event is private and the item's `access_share_code` equals the event's current `share_code`
- **THEN** the item is accessible

#### Scenario: Private event with a stale or absent stored code but a live tag
- **WHEN** an item's event is private, its `access_share_code` is null or no longer matches, but the buyer still has the photo tagged
- **THEN** the item is accessible

#### Scenario: Private event with no valid proof
- **WHEN** an item's event is private, its `access_share_code` does not match the event's current `share_code`, and the buyer does not have the photo tagged
- **THEN** the item is not accessible

### Requirement: Authenticated checkout re-validates accessibility
The authenticated checkout (`createCheckoutSessionAction`) SHALL re-validate every cart item against the
accessibility predicate before creating a Stripe session, at parity with the guest checkout. If any item is
not accessible, checkout MUST refuse and no charge is created.

#### Scenario: Public-then-private flip is refused at checkout
- **GIVEN** a talent added a photo while its event was public (no stored code) and the photographer later set the event private
- **WHEN** the talent proceeds to authenticated checkout and does not have the photo tagged
- **THEN** checkout is refused and no Stripe session is created

#### Scenario: Legitimate private purchase still checks out
- **GIVEN** a talent added a private-event photo with the correct share code (persisted as `access_share_code`)
- **WHEN** the talent proceeds to authenticated checkout and the event is still private with the same share code
- **THEN** checkout proceeds and a Stripe session is created

#### Scenario: Favorites purchase still checks out
- **GIVEN** a talent added a private-event photo they have tagged (no code presented, `access_share_code` null)
- **WHEN** the talent proceeds to authenticated checkout and still has the photo tagged
- **THEN** checkout proceeds and a Stripe session is created

### Requirement: Cart self-heal drops inaccessible items
`getCurrentCart`'s self-heal SHALL drop items that fail the accessibility predicate, so the rendered cart and
the checkout agree on what is buyable — an inaccessible item never lingers in the visible cart to be retried.

#### Scenario: Inaccessible item removed from the rendered cart
- **WHEN** `getCurrentCart` runs and a cart item's event is now private with no valid stored code and no tag
- **THEN** that item is excluded from the returned cart data
