# photographer-payout-ledger Specification

## Purpose

Make every photographer transfer that cannot be sent immediately a durable, exactly-once ledger row that is
retried automatically until it is paid or voided. The webhook's transfer loop previously had three exits that
lost money with nothing but a log line — an inactive Connect account, a net below Stripe's 50-cent minimum,
and a `createTransfer` that throws — and no code path would ever retry them, while the Earnings tab kept
counting that money as available to withdraw. Recording the debt before any Stripe call, keying it on
`(charge, photographer)`, and using that row's id as the idempotency key makes both losing the money and
paying it twice structurally impossible rather than dependent on Stripe's 24-hour idempotency window.

## Requirements

### Requirement: A transfer that cannot be sent is recorded, never dropped

When a sale completes and the platform cannot send a photographer their money, the system SHALL persist a
`payouts` row recording the debt — amount, photographer, charge id, currency, order reference and a
`hold_reason` — instead of only logging it. This applies to every non-sending outcome: an inactive Stripe
Connect account, a net below Stripe's 50-cent transfer minimum, and a `createTransfer` call that throws.

A ledger write failure SHALL NOT fail the webhook, since the payment itself already succeeded.

#### Scenario: Photographer has no active Connect account

- **WHEN** a sale completes and the photographer's Connect status is still not `active` after the live reconcile
- **THEN** a `payouts` row is written with the photographer's net amount, the charge id, the order's currency and `hold_reason = 'connect_inactive'`
- **AND** no Stripe transfer is attempted
- **AND** the webhook still returns success

#### Scenario: Net amount is below the Stripe transfer minimum

- **WHEN** a sale completes and the photographer's net is below 50 cents
- **THEN** a `payouts` row is written with `hold_reason = 'below_minimum'`
- **AND** the amount is carried forward for accumulation rather than discarded

#### Scenario: The Stripe transfer call fails

- **WHEN** `createTransfer` throws for a photographer during a completed sale
- **THEN** the already-created `payouts` row is left outstanding for the retry worker
- **AND** no second `payouts` row is created for that charge and photographer
- **AND** the remaining photographers in the same order are still processed

#### Scenario: Net amount rounds to zero

- **WHEN** a photographer's net for a sale is zero or less
- **THEN** no `payouts` row is written, because the ledger records only positive debts

### Requirement: A sale is never paid twice

The `payouts` row SHALL be created **before** any Stripe transfer call, and its id SHALL be the Stripe
idempotency key (`payout_<row.id>`), used identically by the webhook and the retry worker. A row for a
given `(stripe_charge_id, photographer_id)` pair SHALL be unique; an attempt to open a second row for that
pair SHALL result in no transfer being attempted by the second writer.

Individually payable rows SHALL be transferred with `source_transaction` set to their originating charge,
so that Stripe's own refusal to over-draw a charge outlives the 24-hour idempotency window.

#### Scenario: Stripe redelivers a payment event after the retry worker already paid

- **WHEN** the retry worker has already paid a held sale, and Stripe redelivers `payment_intent.succeeded` for the same charge — including after the 24-hour idempotency window
- **THEN** the webhook finds the ledger row already exists for that `(charge, photographer)` pair
- **AND** no second transfer is created
- **AND** the photographer is paid exactly once

#### Scenario: A transfer succeeded but its response was lost

- **WHEN** a transfer call fails from the caller's point of view although Stripe created the transfer
- **THEN** the retry re-issues under the same `payout_<row.id>` key and the same `source_transaction`
- **AND** Stripe returns the original transfer rather than creating a second one

#### Scenario: Duplicate ledger row detected on the paid path

- **WHEN** recording a completed transfer collides with an existing row for the same charge and photographer
- **THEN** the collision is reported as an error rather than silently ignored, because after the transfer-id uniqueness was removed a collision indicates a probable double payment

### Requirement: Outstanding holds are retried automatically until paid

A background worker SHALL run on a schedule and SHALL also run on demand when a photographer's Connect
account becomes active, paying outstanding holds without manual intervention. It SHALL consider only rows
that carry both a charge id and a hold reason, so rows predating this ledger can never be wired to money.

Rows whose own amount clears the Stripe minimum SHALL be transferred individually. Rows below the minimum
SHALL be aggregated per photographer and currency and transferred only once the group clears the minimum.

#### Scenario: Photographer completes Connect onboarding after selling

- **WHEN** a photographer with outstanding `connect_inactive` holds finishes onboarding and Stripe reports the account active
- **THEN** the retry runs without waiting for the next scheduled tick
- **AND** each held amount is transferred and its row is marked paid

#### Scenario: Two sub-minimum amounts accumulate

- **WHEN** one photographer has two held amounts that are each below the Stripe minimum but together clear it, in the same currency
- **THEN** they are transferred together in a single transfer
- **AND** both rows are marked paid and reference that transfer

#### Scenario: Accumulated total still below the minimum

- **WHEN** a photographer's held amounts still do not reach the Stripe minimum
- **THEN** no transfer is attempted and the rows stay outstanding for a later run

#### Scenario: Amounts in different currencies

- **WHEN** a photographer holds amounts in two different currencies
- **THEN** they are never combined into one transfer

#### Scenario: Photographer is still not active

- **WHEN** the retry runs for a photographer whose Connect account is still not active
- **THEN** no transfer is attempted and the rows stay outstanding

#### Scenario: Retry runs again after paying

- **WHEN** the retry worker runs a second time with no new holds
- **THEN** no further transfer is created

#### Scenario: A concurrent claim leaves a group short

- **WHEN** a group is selected for aggregation but another run has already taken some of its rows, leaving the claimed total below the minimum
- **THEN** the claimed rows are released back to outstanding rather than left permanently stuck

#### Scenario: Rows predating the ledger

- **WHEN** outstanding rows exist that carry no charge id or no hold reason
- **THEN** the retry worker ignores them entirely

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

#### Scenario: A partial refund never wipes a hold

- **WHEN** a partial refund reduces a hold, however large the refunded fraction
- **THEN** the hold retains at least the smallest payable amount
- **AND** only a full refund voids it

#### Scenario: The ledger records money taken back after it was sent

- **WHEN** a payout that was already paid is reversed because its charge was refunded or its dispute lost
- **THEN** the payout row records the reversed amount and the reversal reference
- **AND** the photographer's paid-out total counts only the amount not reversed

### Requirement: Photographers cannot write their own payout rows

Because an outstanding row now causes real money to be sent, the `payouts` table SHALL be readable by the
owning photographer and writable only by the service role. Photographers SHALL NOT be able to insert or
update payout rows directly.

#### Scenario: Photographer attempts to insert a payout row

- **WHEN** an authenticated photographer inserts a `payouts` row for themselves through the data API
- **THEN** the insert is rejected

#### Scenario: Photographer attempts to update a payout row

- **WHEN** an authenticated photographer updates one of their own payout rows through the data API
- **THEN** the update is rejected

#### Scenario: Photographer reads their own payouts

- **WHEN** an authenticated photographer selects their own payout rows
- **THEN** the rows are returned

#### Scenario: Service role still writes

- **WHEN** the webhook or the retry worker writes a payout row using the service role
- **THEN** the write succeeds

### Requirement: An in-flight payout cannot be altered out of band

The administrative payout endpoint SHALL refuse to change a row that is in flight or that belongs to a
ledger-tracked charge, so an administrator cannot desync a row mid-transfer or cancel a hold into a state
where the uniqueness key prevents ever creating a replacement.

#### Scenario: Admin acts on an in-flight row

- **WHEN** an administrator submits a status change for a row that is in flight or carries a charge id
- **THEN** the request is refused and the row is unchanged

### Requirement: The photographer sees what is owed, distinguished from what is available

The earnings view SHALL show the amount that is recorded as owed but not yet sent, distinguished from
money already in the photographer's own Stripe account. Money that is in flight SHALL be counted as owed
rather than as withdrawable. Payout history SHALL show each row's real status rather than presenting every
row as paid.

#### Scenario: Photographer has outstanding holds

- **WHEN** a photographer with outstanding holds opens the earnings view
- **THEN** a pending-payout figure shows that total
- **AND** it is not presented as available to withdraw

#### Scenario: A payout is in flight

- **WHEN** a payout row is in flight
- **THEN** its amount counts toward the pending total, not the withdrawable balance

#### Scenario: Payout history contains a non-paid row

- **WHEN** the payout history includes an outstanding or in-flight row
- **THEN** it is listed with its actual status instead of being hidden or labelled paid
