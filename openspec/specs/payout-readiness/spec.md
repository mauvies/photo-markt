# payout-readiness Specification

## Purpose

Define what the product does when a photographer who is selling cannot yet receive money: that the
sale still happens and the money is held rather than refused, and that the photographer is warned in
proportion to what is actually at stake.

Distinct from `photographer-payout-ledger`, which specifies how a held amount is recorded, retried and
settled. This capability owns the decisions **around** that ledger — whether a sale is allowed at all,
and what the photographer is told.

## Requirements

### Requirement: A sale is never refused because the photographer cannot be paid

Neither checkout entry point (guest or authenticated) SHALL consider the photographer's Stripe Connect
status when deciding whether to create a checkout session. A photographer who cannot yet receive money
SHALL still be able to sell; their net SHALL be recorded as an outstanding hold and paid automatically
once their account can receive it, as specified by `photographer-payout-ledger`.

The buyer SHALL NOT be told anything about the photographer's payout state. Their purchase is complete
and correct, and the information is not actionable for them.

#### Scenario: Guest buys from a photographer with no payout account

- **WHEN** a guest checks out a cart whose photographer's Connect status is not `active`
- **THEN** a Stripe checkout session is created as for any other cart
- **AND** on payment the order completes and the photos become downloadable
- **AND** the photographer's net is recorded as an outstanding hold rather than transferred

#### Scenario: Authenticated buyer buys from a photographer with no payout account

- **WHEN** an authenticated buyer checks out a cart whose photographer's Connect status is not `active`
- **THEN** a Stripe checkout session is created as for any other cart
- **AND** on payment the order completes and the photos become downloadable
- **AND** the photographer's net is recorded as an outstanding hold rather than transferred

#### Scenario: A cart mixes a payable and an unpayable photographer

- **WHEN** a cart contains photos from one photographer who is `active` and one who is not
- **THEN** the whole cart is purchasable
- **AND** the active photographer is paid while the other's net is held

#### Scenario: A stale cached Connect status does not block a working account

- **GIVEN** a photographer whose account is active at Stripe but whose stored status is still `pending`
- **WHEN** a buyer checks out their photos
- **THEN** the sale proceeds, because no checkout decision reads that status at all

### Requirement: The photographer is warned in proportion to what is at stake

The system SHALL warn a photographer whose Connect account is not `active`, and the warning's urgency
SHALL be decided by whether money is actually being withheld rather than by whether events merely
carry a price. That decision SHALL live in one place, so that every surface showing it agrees.

The warning SHALL state that the money is not lost and is sent automatically once the account can
receive it, and SHALL link to the payout settings.

#### Scenario: Money is already held

- **WHEN** a photographer whose Connect account is not `active` has outstanding held payouts
- **THEN** they are warned at the highest urgency, naming the amount waiting for them

#### Scenario: Priced events exist but nothing has sold

- **WHEN** a photographer whose Connect account is not `active` has priced events and no held payouts
- **THEN** they are warned that sales will be held until they connect, at a lower urgency than money
  already waiting

#### Scenario: Nothing is priced yet

- **WHEN** a photographer whose Connect account is not `active` has no priced events and no held payouts
- **THEN** they see only the ordinary unfinished-setup nudge

#### Scenario: Free events never warn

- **WHEN** a photographer's only events have no price
- **THEN** no payout warning is shown, because no payout account is needed to run them

#### Scenario: An active account is never warned

- **WHEN** a photographer's Connect account is `active`
- **THEN** no payout-readiness warning is shown on any surface, whatever their events cost

### Requirement: The per-event warning outlives the save that caused it

An event that is priced while its owner cannot be paid SHALL carry the warning on the event itself for
as long as both remain true, rather than only at the moment of saving a price. The warning SHALL be
placed so that it does not depend on which section of the event the photographer is viewing.

#### Scenario: Returning to a priced event later

- **WHEN** the owner of a priced event whose Connect account is not `active` opens that event
- **THEN** the warning is shown regardless of how much time has passed since the price was set

#### Scenario: The event is free

- **WHEN** the owner opens an event with no price
- **THEN** no warning is shown, whatever their Connect status

#### Scenario: The account becomes active

- **WHEN** the owner connects their payout account and Stripe reports it active
- **THEN** the event's warning disappears without any further edit to the event
