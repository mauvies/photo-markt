## MODIFIED Requirements

### Requirement: An in-flight payout cannot be altered out of band

The system SHALL expose no administrative surface that changes a payout row's status. Ledger rows
SHALL be written only by service-role paths that own the corresponding money event — the transfer
path, the retry worker, and the refund handler that voids holds for a reversed charge — so no
request can desync a row mid-transfer or cancel a hold into a state where the uniqueness key
prevents ever creating a replacement.

A status change is not a transfer: moving a row to `paid` moves no money, so a surface that could do
it would let the ledger — the record an operator reconciles Stripe against — assert a payment that
never happened. Cancelling a hold is likewise reserved to the refund path, which cancels it because
the charge behind it was reversed; a cancellation with no such event behind it is what leaves the
debt permanently unpayable.

#### Scenario: No administrative payout endpoint exists

- **WHEN** a request is made to change a payout row's status through an administrative HTTP endpoint
- **THEN** no such endpoint exists to serve it

#### Scenario: Service role still writes

- **WHEN** the webhook, the retry worker, or the refund handler writes, settles or voids a payout
  row using the service role
- **THEN** the write succeeds

#### Scenario: The automatic path is unaffected

- **WHEN** a hold is outstanding and the photographer's payout account becomes active
- **THEN** the retry worker still drains the hold without any human action
