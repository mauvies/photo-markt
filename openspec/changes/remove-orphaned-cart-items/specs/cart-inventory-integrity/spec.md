## ADDED Requirements

### Requirement: Purchasability predicate
The system SHALL define a single, reusable predicate for whether a photo is currently purchasable: its
row exists, `upload_status = 'approved'`, and its event's `deleted_at` is null. Every requirement below
MUST use this same predicate — there SHALL NOT be a second, divergent definition of "purchasable"
anywhere in the cart or checkout code paths.

#### Scenario: Photo hard-deleted
- **WHEN** a photo id is checked against the purchasability predicate and no `photos` row with that id
  exists
- **THEN** the id is excluded from the purchasable set

#### Scenario: Photo's event soft-deleted
- **WHEN** a photo's row exists but its event has a non-null `deleted_at`
- **THEN** the id is excluded from the purchasable set

#### Scenario: Photo not approved
- **WHEN** a photo's row exists, its event is not deleted, but `upload_status` is `pending` or
  `rejected`
- **THEN** the id is excluded from the purchasable set

#### Scenario: Fully purchasable photo
- **WHEN** a photo's row exists, `upload_status = 'approved'`, and its event's `deleted_at` is null
- **THEN** the id is included in the purchasable set

### Requirement: Cross-user cart cleanup on photo/event deletion
The system SHALL ensure that when a photographer deletes a photo (individually, in bulk, or via an
event-delete cascade), no `cart_items` row belonging to ANY user continues to reference that photo.

#### Scenario: Another user's cart item is removed when its photo is deleted
- **GIVEN** a talent user has photo P in their cart
- **WHEN** the photographer who owns photo P deletes it (individually, via bulk delete, or via event
  deletion cascading to P)
- **THEN** the talent user's `cart_items` row referencing photo P no longer exists

### Requirement: Authenticated cart self-heals and notifies on load
When the authenticated cart is loaded, the system SHALL detect any `cart_items` row referencing a
photo that is no longer purchasable (per the purchasability predicate), delete those rows, and report
how many were removed so the caller can notify the user.

#### Scenario: Cart item removed because its event was soft-deleted
- **GIVEN** an authenticated user's cart contains a photo whose event has since been soft-deleted
- **WHEN** the user loads their cart
- **THEN** the corresponding `cart_items` row is deleted and the returned cart data reports a non-zero
  removed count

#### Scenario: Cart item removed because the photo is no longer approved
- **GIVEN** an authenticated user's cart contains a photo whose `upload_status` has changed from
  `approved` to `rejected` since it was added
- **WHEN** the user loads their cart
- **THEN** the corresponding `cart_items` row is deleted and the returned cart data reports a non-zero
  removed count

#### Scenario: Clean cart reports no removals
- **GIVEN** every photo in an authenticated user's cart is currently purchasable
- **WHEN** the user loads their cart
- **THEN** no `cart_items` rows are deleted and the returned cart data reports a removed count of zero

### Requirement: Guest cart live validation on load
The system SHALL validate every photo id in a guest (localStorage) cart against the purchasability
predicate when the guest cart page loads, and report which ids are no longer valid so the client can
drop them.

#### Scenario: Guest cart entry for a deleted photo is flagged
- **GIVEN** a guest cart (client-held list of photo ids) contains a photo id that no longer has a
  `photos` row
- **WHEN** the guest cart page loads and validates its photo ids
- **THEN** that photo id is reported as removed and is not included in the resolved preview map

#### Scenario: Guest cart entry for a purchasable photo is retained
- **GIVEN** a guest cart contains only currently-purchasable photo ids
- **WHEN** the guest cart page loads and validates its photo ids
- **THEN** no ids are reported as removed

### Requirement: User notice on cart cleanup
Both cart surfaces (authenticated and guest) SHALL show the user a clear notice when one or more items
were removed from their cart because the underlying photo is no longer available.

#### Scenario: Guest cart shows a notice after removing unavailable items
- **GIVEN** the guest cart page validation reports one or more removed photo ids
- **WHEN** the cart page finishes loading
- **THEN** the user sees a notice that one or more items were removed because they're no longer
  available

#### Scenario: Authenticated cart shows a notice after removing unavailable items
- **GIVEN** loading the authenticated cart reports a non-zero removed count
- **WHEN** the cart page finishes loading
- **THEN** the user sees the same notice

#### Scenario: No notice when nothing was removed
- **GIVEN** no items were removed on cart load (guest or authenticated)
- **WHEN** the cart page finishes loading
- **THEN** no removal notice is shown

### Requirement: Checkout re-validates purchasability before charging
Both checkout entry points (authenticated and guest) SHALL re-check every cart item against the
purchasability predicate immediately before creating a Stripe checkout session, and SHALL refuse to
create that session if any item fails the check.

#### Scenario: Authenticated checkout rejects a cart containing an unpurchasable item
- **GIVEN** an authenticated user's cart contains at least one photo that is no longer purchasable
- **WHEN** the user starts checkout
- **THEN** no Stripe checkout session is created and the user sees an error asking them to review their
  cart

#### Scenario: Guest checkout rejects a cart containing an unpurchasable item
- **GIVEN** a guest checkout request includes at least one photo id that is no longer purchasable
- **WHEN** the guest starts checkout
- **THEN** no Stripe checkout session is created and the guest sees an error asking them to review their
  cart

#### Scenario: Checkout proceeds when every item is purchasable
- **GIVEN** every item in a cart (authenticated or guest) is currently purchasable
- **WHEN** checkout is started
- **THEN** a Stripe checkout session is created as before, with no behavior change

### Requirement: Historical orders are never touched
Cart cleanup, guest cart validation, and checkout re-validation SHALL NOT delete or modify any
`orders` or `order_items` row, regardless of whether the referenced photo is later deleted or made
unpurchasable.

#### Scenario: A completed order referencing a later-deleted photo is unaffected
- **GIVEN** a photo was purchased and its `order_items` row exists
- **WHEN** the photographer later deletes that photo (photo rows for purchased photos are excluded
  from photo deletion by existing behavior) or the cart-cleanup/checkout logic in this capability runs
- **THEN** the `orders` and `order_items` rows are unchanged
