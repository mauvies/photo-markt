## MODIFIED Requirements

### Requirement: A refunded charge does not pay out

When a charge is refunded, the system SHALL stop the retry worker from sending money for the refunded
portion of that sale. A **full** refund SHALL void any outstanding hold belonging to the charge. A
**partial** refund SHALL reduce what is payable on the outstanding hold in proportion to the refunded
fraction rather than voiding it, so the photographer keeps their net on the part of the sale the buyer did
not get back.

The reduction SHALL be expressed as a target the row is moved to, never as a delta applied to whatever the
row currently holds, so that repeated delivery of one event moves money once.

#### Scenario: Refund arrives while a hold is outstanding

- **WHEN** `charge.refunded` is received for the full amount of a charge that has an outstanding hold
- **THEN** the hold is voided
- **AND** the retry worker never transfers it

#### Scenario: Partial refund arrives while a hold is outstanding

- **WHEN** `charge.refunded` is received for part of a charge that has an outstanding hold
- **THEN** the hold survives with its payable amount reduced in proportion to the refunded fraction
- **AND** the retry worker may still pay the reduced amount

#### Scenario: The same refund is delivered repeatedly

- **WHEN** Stripe redelivers one partial refund any number of times
- **THEN** the hold ends at the same reduced amount as after the first delivery
- **AND** no further money is taken back

#### Scenario: The charge total cannot be resolved

- **WHEN** a clawback runs but the charge total cannot be read from Stripe
- **THEN** nothing is reduced, voided or reversed
- **AND** the incident is reported for reconciliation

#### Scenario: The ledger records money taken back after it was sent

- **WHEN** a payout that was already paid is reversed because its charge was refunded or its dispute lost
- **THEN** the payout row records the reversed amount and the reversal reference
- **AND** the photographer's paid-out total counts only the amount not reversed

### Requirement: A held payout is claimed before its transfer

The worker SHALL move a payout row out of the payable state before calling Stripe for it, so that no later
run can select the same row while its transfer is in flight.

#### Scenario: A claim is abandoned mid-flight

- **WHEN** a claimed row is left unresolved past the staleness window
- **THEN** the worker asks Stripe whether that transfer exists
- **AND** settles the row if it does, hands the claim back if it provably does not, and changes nothing if
  the answer is inconclusive
