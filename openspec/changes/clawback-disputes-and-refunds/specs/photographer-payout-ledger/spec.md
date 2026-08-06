## MODIFIED Requirements

### Requirement: A refunded charge does not pay out

When a charge is refunded, the system SHALL stop the retry worker from sending money for the refunded
portion of that sale. A **full** refund SHALL void any outstanding hold belonging to the charge. A
**partial** refund SHALL reduce the outstanding hold in proportion to the refunded fraction rather than
voiding it, so the photographer keeps their net on the part of the sale the buyer did not get back.

#### Scenario: Refund arrives while a hold is outstanding

- **WHEN** `charge.refunded` is received for the full amount of a charge that has an outstanding hold
- **THEN** the hold is voided
- **AND** the retry worker never transfers it

#### Scenario: Partial refund arrives while a hold is outstanding

- **WHEN** `charge.refunded` is received for part of a charge that has an outstanding hold
- **THEN** the hold survives with its amount reduced in proportion to the refunded fraction
- **AND** the retry worker may still pay the reduced amount

#### Scenario: A partial refund leaves nothing payable

- **WHEN** the proportional reduction would leave a hold at zero or below
- **THEN** the hold is voided instead, and the reason is recorded

#### Scenario: The ledger records money taken back after it was sent

- **WHEN** a payout that was already paid is reversed because its charge was refunded or its dispute lost
- **THEN** the payout row records the reversed amount and the reversal reference
- **AND** the photographer's paid-out total counts only the amount not reversed
