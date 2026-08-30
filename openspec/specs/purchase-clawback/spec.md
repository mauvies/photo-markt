# purchase-clawback Specification

## Purpose

Unwind a purchase that the buyer has taken back. A chargeback is forced unilaterally through the buyer's
bank and bypasses our terms entirely, so it is precisely the route someone would take to download without
paying — yet the webhook handled no dispute event at all, leaving a lost dispute with the order still
`completed`, the buyer's download access intact, the photographer's transfer unrecovered and nothing
logged or alerted. `charge.refunded` was handled only halfway: access was revoked, but money already sent
to the photographer was never reversed. This capability makes both sides of a reversal — the buyer's
access and the photographer's money — unwind together, proportionally when only part of a charge is
reversed, and puts both back when a dispute is won.

## Requirements

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

#### Scenario: A partial refund never wipes the hold entirely

- **WHEN** a partial refund reduces a hold, however large the refunded fraction
- **THEN** the hold retains at least the smallest payable amount rather than being voided
- **AND** a hold reduced below the transfer minimum is still paid through the aggregation path

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

### Requirement: A freeze or unfreeze that fails is alerted, never merely logged

The system SHALL raise an operational alert whenever freezing or releasing a charge's payout holds
fails, while still acknowledging the event. Neither operation may throw — a 500 makes Stripe redeliver
the event — so the failure is invisible unless it is surfaced deliberately.

Each failure SHALL carry its own incident kind, because the two have opposite consequences and
opposite remediations: a failed freeze leaves money payable that should not be paid, and a failed
unfreeze leaves money unpayable that should be paid.

#### Scenario: The freeze fails when a dispute is opened

- **WHEN** a dispute is opened and freezing the charge's outstanding holds fails
- **THEN** the webhook still returns a success response so Stripe does not redeliver a money operation
- **AND** an operational alert is raised naming the charge and the dispute, and stating that the
  affected holds remain payable by the retry worker

#### Scenario: The unfreeze fails when a dispute closes in our favour

- **WHEN** a dispute closes without loss and releasing the freeze fails
- **THEN** the webhook still returns a success response
- **AND** an operational alert is raised, distinct in kind from the failed-freeze alert, stating that
  the affected holds remain frozen and cannot be paid

#### Scenario: The alert does not change what the handler does

- **WHEN** either failure is alerted
- **THEN** the order's status, the buyer's access and every other side effect of the event are exactly
  what they would have been without the alert

### Requirement: A freeze that outlives its dispute is released or reported

The system SHALL periodically examine holds frozen longer than a dispute resolution would take,
resolve each freeze against the dispute's real status at Stripe, and release only the unambiguous
case. A frozen hold is excluded from every payout selector, so a freeze that is never released is a
debt that can never be paid.

The sweep SHALL never conclude from a failed or missing read, SHALL raise no alert for a freeze that
is still legitimate, and SHALL report what it cannot resolve at most once per rolling day under its
own incident kind.

#### Scenario: The dispute closed without loss

- **WHEN** the sweep finds holds frozen by a dispute that Stripe reports as closed and not lost
- **THEN** the freeze is released, using the same idempotent operation scoped to that dispute
- **AND** the released holds become payable again on the normal payout path

#### Scenario: The dispute was lost

- **WHEN** the sweep finds holds frozen by a dispute that Stripe reports as lost
- **THEN** nothing is released and no alert is raised, because the freeze is the correct terminal
  state for money the buyer took back

#### Scenario: The dispute is still open

- **WHEN** the sweep finds holds frozen by a dispute Stripe reports as still open
- **THEN** nothing is released and no alert is raised, because a chargeback legitimately stays open
  for weeks

#### Scenario: The dispute's status cannot be established

- **WHEN** the dispute cannot be read from Stripe, or no longer exists there
- **THEN** the freeze is left exactly as it is
- **AND** the row is reported for manual resolution

#### Scenario: The report does not repeat every pass

- **WHEN** the sweep runs repeatedly while the same unresolved rows remain frozen
- **THEN** one aggregated incident is raised for the whole set at most once per rolling day, rather
  than one per row per pass

#### Scenario: A recently frozen hold is left alone

- **WHEN** a hold was frozen more recently than the staleness window
- **THEN** the sweep neither reads Stripe for it nor reports it
