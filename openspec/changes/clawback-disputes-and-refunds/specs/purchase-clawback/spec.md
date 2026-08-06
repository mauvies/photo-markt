## ADDED Requirements

### Requirement: An opened dispute revokes the buyer's access immediately

When a chargeback is opened against a purchase, the system SHALL mark the corresponding order as
disputed so the buyer loses download access at once, without waiting for the dispute to close. The order
SHALL be resolvable whether the purchase was made by an authenticated buyer or a guest.

#### Scenario: Dispute opened on an authenticated purchase

- **WHEN** `charge.dispute.created` is received for a charge belonging to a completed order
- **THEN** the order's status becomes `disputed`
- **AND** the buyer's purchased-photo reads and the ZIP download no longer include that order's photos

#### Scenario: Dispute opened on a guest purchase

- **WHEN** `charge.dispute.created` is received for a charge belonging to a completed guest order
- **THEN** the guest order's status becomes `disputed`
- **AND** the guest download-token page no longer serves the photos

#### Scenario: Outstanding holds are frozen while the dispute is open

- **WHEN** a dispute is opened for a charge that still has an outstanding payout hold
- **THEN** the hold is voided and marked as voided by a dispute
- **AND** the retry worker never transfers it while the dispute is open

#### Scenario: Operator is alerted

- **WHEN** a dispute is opened
- **THEN** an operational alert is raised, carrying the charge and the order reference

### Requirement: A lost dispute reverses the photographer's transfer

When a dispute is lost, the system SHALL reverse the photographer's transfer for the disputed amount, so
the platform does not fund a sale the buyer's bank has taken back. The dispute fee SHALL be recorded as a
platform cost and SHALL NOT be charged to the photographer.

#### Scenario: Dispute lost after the transfer was already sent

- **WHEN** `charge.dispute.closed` is received with status `lost` for a charge whose payout was paid
- **THEN** a transfer reversal is created for the photographer's net on the disputed amount
- **AND** the payout row records the reversed amount and the reversal id
- **AND** the photographer's paid-out total drops by the reversed amount

#### Scenario: Dispute fee is not passed on

- **WHEN** a dispute is lost and Stripe has charged a dispute fee
- **THEN** the fee is recorded against the order as a platform cost
- **AND** no part of the fee is deducted from the photographer

#### Scenario: Buyer keeps no access

- **WHEN** a dispute is lost
- **THEN** the order remains disputed and the buyer's access stays revoked

### Requirement: A won dispute restores what the dispute revoked

When a dispute is won, the system SHALL put back exactly what opening the dispute took away: the buyer's
access and the photographer's outstanding hold.

#### Scenario: Dispute won

- **WHEN** `charge.dispute.closed` is received with status `won`
- **THEN** the order returns to `completed` and the buyer's access is restored
- **AND** any hold voided by that dispute returns to outstanding so the retry worker can pay it

#### Scenario: A hold voided by a refund is not resurrected

- **WHEN** a dispute is won on a charge that also had a hold voided by an earlier refund
- **THEN** only the holds voided by the dispute are restored
- **AND** the refund-voided hold stays voided

### Requirement: A refund reverses money already sent to the photographer

When a charge is refunded, the system SHALL reverse the photographer's transfer for the refunded portion,
in addition to voiding or reducing money not yet sent. Reversal SHALL be idempotent against webhook
redelivery.

#### Scenario: Full refund after the transfer was sent

- **WHEN** `charge.refunded` is received for the full charge amount and the payout was paid
- **THEN** the photographer's whole net for that charge is reversed
- **AND** the payout row is recorded as reversed

#### Scenario: The same refund event is redelivered

- **WHEN** the same `charge.refunded` event is delivered a second time
- **THEN** the reversal request reuses its idempotency key
- **AND** no second reversal is created

#### Scenario: A second, larger partial refund arrives

- **WHEN** a further partial refund raises the cumulative refunded amount
- **THEN** a new reversal is created for the difference only
- **AND** the total reversed never exceeds the amount originally transferred

#### Scenario: Guest purchase is refunded

- **WHEN** `charge.refunded` is received for a guest order's charge
- **THEN** the guest order's status becomes `refunded`
- **AND** the guest download-token page stops serving the photos

### Requirement: A partial reversal is proportional, never all-or-nothing

When only part of a charge is refunded or disputed, the system SHALL unwind the photographer's money in
proportion to the reversed fraction, both for money already sent and for money still held.

#### Scenario: Partial refund with the transfer already sent

- **WHEN** a quarter of a charge is refunded and the payout was paid
- **THEN** approximately a quarter of the photographer's net is reversed
- **AND** the remainder stays with the photographer

#### Scenario: Partial refund with money still held

- **WHEN** a quarter of a charge is refunded and the payout is still an outstanding hold
- **THEN** the hold survives with its amount reduced by approximately a quarter
- **AND** the retry worker can still pay the reduced amount

#### Scenario: The remaining amount is too small to be payable

- **WHEN** a partial refund would reduce a hold to zero or less
- **THEN** the hold is voided instead of being written with an invalid amount

### Requirement: A clawback failure is recorded and alerted, never silent and never fatal

The system SHALL treat a failed clawback as an incident to be surfaced rather than an error to be thrown:
the webhook SHALL still acknowledge the event, and the affected row SHALL be marked for reconciliation.

#### Scenario: The reversal call fails

- **WHEN** creating a transfer reversal fails, for example for insufficient balance on the connected
  account
- **THEN** the webhook still returns a success response so Stripe does not redeliver a money operation
- **AND** the failure is recorded against the payout row and raised as an operational alert

#### Scenario: A transfer is in flight when the reversal is attempted

- **WHEN** a clawback finds a payout whose transfer may still be in flight
- **THEN** the system probes Stripe for that transfer before acting
- **AND** it reverses only a transfer confirmed to exist, alerting for manual reconciliation otherwise
