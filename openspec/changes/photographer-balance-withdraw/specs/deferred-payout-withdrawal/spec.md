# deferred-payout-withdrawal Specification (delta)

## ADDED Requirements

### Requirement: Sales always credit the photographer
On `payment_intent.succeeded`, the system SHALL record the photographer's net earnings
(commission-adjusted) for every order item, regardless of the photographer's Connect status. For an
`active` photographer the immediate transfer SHALL be preserved exactly as today and the ledger SHALL
record a matched `sale_credit` + `withdrawal` pair (net zero). For a non-`active` photographer the
system SHALL record a `sale_credit` and create no transfer — never silently dropping the amount.

#### Scenario: Active photographer — unchanged money path, journaled
- **GIVEN** a buyer completes payment for photos of an `active` photographer
- **WHEN** the webhook processes the payment
- **THEN** an immediate transfer is created as before AND the ledger gains `sale_credit +net` and
  `withdrawal -net`, leaving their balance at 0

#### Scenario: Non-active photographer — credited, not dropped
- **GIVEN** a buyer completes payment for photos of a photographer whose Connect status is not
  `active` (after live reconciliation of a stale cached status)
- **WHEN** the webhook processes the payment
- **THEN** no transfer is created and the ledger gains `sale_credit +net`, increasing their pending
  balance by the net amount

#### Scenario: Sub-minimum net accumulates
- **GIVEN** a photographer's net for an order is below the 50-cent transfer minimum
- **WHEN** the webhook processes the payment
- **THEN** the amount is credited to their ledger balance (no transfer, no warn-and-drop) and remains
  withdrawable once the accumulated balance reaches the minimum

### Requirement: Automatic withdrawal on Connect activation
When an `account.updated` event transitions a photographer's derived Connect status to `active`, the
system SHALL transfer their entire pending ledger balance (if at or above the transfer minimum) to
their Connect account in a single transfer, record a matching `withdrawal` ledger entry and a
`payouts` row, and leave the balance untouched on any failure so a later event or the reconciliation
job can retry. The withdrawal SHALL be idempotent.

#### Scenario: Activation sweeps the pending balance
- **GIVEN** a photographer holds a pending ledger balance of 4500 cents
- **WHEN** their Connect account becomes `active`
- **THEN** one transfer of 4500 cents is created, the ledger records `withdrawal -4500`, and a
  `payouts` row documents the transfer

#### Scenario: Failed withdrawal leaves the balance intact
- **GIVEN** the activation transfer fails (Stripe error)
- **WHEN** the handler completes
- **THEN** no `withdrawal` entry is written, the balance is unchanged, and a retry (next event or
  reconciliation run) can complete the withdrawal without double-paying

### Requirement: Refunds net against un-withdrawn credits
On `charge.refunded`, the system SHALL debit (`refund_debit`) each affected photographer's ledger by
the refunded portion of their net credit ONLY when that credit has not yet been withdrawn. Credits
already withdrawn SHALL NOT be auto-reversed (manual reversal remains the documented procedure).
Partial refunds SHALL debit proportionally, rounding in the photographer's favor.

#### Scenario: Refund before withdrawal claws back the credit
- **GIVEN** a non-active photographer holds an un-withdrawn `sale_credit` of 1000 cents from charge C
- **WHEN** charge C is fully refunded
- **THEN** the ledger gains `refund_debit -1000` and their pending balance decreases accordingly

#### Scenario: Refund after withdrawal is not auto-reversed
- **GIVEN** a photographer's credit from charge C was already withdrawn to their Connect account
- **WHEN** charge C is refunded
- **THEN** no automatic ledger debit or transfer reversal occurs (manual procedure applies, unchanged)

### Requirement: Pending balance is visible to the photographer
The photographer earnings view SHALL display the pending ledger balance with copy explaining that the
funds accumulate until payouts are configured, in both supported locales.

#### Scenario: Non-connected photographer sees accumulated earnings
- **GIVEN** a photographer without an active Connect account has a pending balance of 3000 cents
- **WHEN** they open the earnings tab
- **THEN** they see the 3000-cent pending balance and an explanation that connecting payouts releases
  it
