# cart-inventory-integrity Specification (delta)

## ADDED Requirements

### Requirement: Payment-readiness does not gate purchasability
Checkout (authenticated and guest) SHALL NOT reject a cart because a photographer's Stripe Connect
account is not active. Purchasability SHALL be determined solely by the existing purchasability and
accessibility predicates (photo exists, approved, event not deleted, access proven); the
photographer's payout-readiness is handled downstream by the earnings ledger and MUST NOT surface as
a buyer-facing error or a disabled add-to-cart control.

#### Scenario: Buyer checks out photos of a non-connected photographer
- **GIVEN** a cart contains photos whose photographer has no active Stripe Connect account
- **WHEN** the buyer starts checkout (authenticated or guest)
- **THEN** the Stripe checkout session is created normally and the purchase completes, with the
  photographer's net credited to their earnings ledger

#### Scenario: No payment-readiness gate remains in the checkout paths
- **WHEN** the checkout code paths are inspected
- **THEN** no rejection keyed on `stripe_connect_status` exists in either checkout action
