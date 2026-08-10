## ADDED Requirements

### Requirement: A chargeback revokes the buyer's access immediately; an inquiry does not

When a **chargeback** is opened against a purchase, the system SHALL mark the corresponding order as
disputed so the buyer loses download access at once, without waiting for the dispute to close. The order
SHALL be resolvable whether the purchase was made by an authenticated buyer or a guest.

An **inquiry** — a dispute whose status is in the `warning_*` family — SHALL NOT touch access. Inquiries
arrive through the same event as chargebacks and frequently close by themselves, so revoking a paying
buyer's photos over a bank's question is damage taken for a suspicion.

#### Scenario: Chargeback opened on an authenticated purchase

- **WHEN** `charge.dispute.created` is received with a chargeback status for a charge belonging to a
  completed order
- **THEN** the order's status becomes `disputed`
- **AND** the buyer's purchased-photo reads and the ZIP download no longer include that order's photos

#### Scenario: Chargeback opened on a guest purchase

- **WHEN** `charge.dispute.created` is received with a chargeback status for a completed guest order
- **THEN** the guest order's status becomes `disputed`
- **AND** the guest download-token page no longer serves the photos

#### Scenario: Inquiry opened

- **WHEN** `charge.dispute.created` is received with a `warning_*` status
- **THEN** the buyer keeps their access
- **AND** the outstanding payout hold is frozen

#### Scenario: An inquiry escalates to a chargeback

- **WHEN** the dispute's status leaves the `warning_*` family and arrives as `charge.dispute.updated`
- **THEN** the order becomes `disputed` and the buyer's access is revoked
- **AND** the frozen hold follows access out of the photographer's outstanding balance

#### Scenario: Operator is alerted

- **WHEN** a dispute is opened
- **THEN** an operational alert is raised, carrying the charge and the order reference

### Requirement: Freezing a payout does not move the photographer's balance

The system SHALL keep a frozen hold counted in the photographer's outstanding payouts for exactly as long
as its sale is counted in their earnings, so that freezing changes only what may be sent — never what the
photographer is told they are owed.

#### Scenario: An inquiry is opened while a hold is outstanding

- **WHEN** an inquiry freezes an outstanding hold and the order keeps its access
- **THEN** the photographer's withdrawable balance is unchanged
- **AND** the retry worker will not transfer the frozen hold

#### Scenario: A chargeback is opened while a hold is outstanding

- **WHEN** a chargeback freezes an outstanding hold and the order loses its access
- **THEN** the sale and the hold leave the balance together
- **AND** the photographer's other earnings are untouched

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

### Requirement: A dispute that closes without loss releases its own freeze and nothing else

When a dispute closes as `won`, `warning_closed` or `prevented`, the system SHALL release exactly the
holds that dispute froze, and SHALL recompute the buyer's access from the facts rather than restoring it.

There is no "restore": settling a chargeback by refunding the buyer is the normal path, and an
unconditional flip back to `completed` handed a fully refunded buyer permanent access to the originals.

#### Scenario: Dispute won on a sale that was not refunded

- **WHEN** `charge.dispute.closed` is received with status `won` and nothing was refunded
- **THEN** the order is `completed` and the buyer's access is restored
- **AND** the hold that dispute froze becomes payable again

#### Scenario: Dispute won after refunding the buyer to settle it

- **WHEN** a dispute is won on a charge that was refunded in full
- **THEN** the order stays `refunded` and the buyer's access stays revoked
- **AND** the released hold is reconciled against the refund rather than paid

#### Scenario: A hold voided by a refund is not resurrected

- **WHEN** a dispute closes without loss on a charge that also had a hold voided by an earlier refund
- **THEN** only the holds that dispute froze are released
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

### Requirement: A partial reversal is proportional, and does not revoke access

When only part of a charge is refunded or disputed, the system SHALL unwind the photographer's money in
proportion to the reversed fraction, both for money already sent and for money still held.

A partial refund SHALL NOT revoke the buyer's access. Stripe refunds are amounts, not line items, so a
partial refund carries no information about which photos it covers; revoking the whole order also dropped
the entire sale out of the photographer's earnings while only the refunded fraction came back out of their
paid-out total, taking the difference from their unrelated sales.

#### Scenario: Partial refund with the transfer already sent

- **WHEN** a quarter of a charge is refunded and the payout was paid
- **THEN** approximately a quarter of the photographer's net is reversed
- **AND** the remainder stays with the photographer

#### Scenario: Partial refund with money still held

- **WHEN** a quarter of a charge is refunded and the payout is still an outstanding hold
- **THEN** approximately a quarter of the hold stops being payable
- **AND** the retry worker can still pay the remainder

#### Scenario: Buyer keeps their photos after a partial refund

- **WHEN** part of a charge is refunded
- **THEN** the order stays `completed`
- **AND** the buyer keeps access to the photos they bought

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
