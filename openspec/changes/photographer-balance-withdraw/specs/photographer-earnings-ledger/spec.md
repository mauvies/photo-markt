# photographer-earnings-ledger Specification (delta)

## ADDED Requirements

### Requirement: Append-only earnings ledger
The system SHALL record every movement of photographer earnings as an immutable row in
`ledger_entries` with a signed `amount_cents` (credits positive, debits negative) and a `type` of
`sale_credit`, `withdrawal`, `refund_debit`, or `adjustment`. Rows SHALL never be updated or deleted by
application code; corrections MUST be expressed as new `adjustment` entries. A photographer's balance
SHALL always be derived as `SUM(amount_cents)` over their rows — the system SHALL NOT maintain a
mutable balance column.

#### Scenario: Balance is the sum of entries
- **GIVEN** a photographer has ledger entries +1000, +500, -800
- **WHEN** their balance is queried
- **THEN** the balance is 700 cents, computed by summation, with no stored balance field involved

#### Scenario: Corrections are new entries
- **WHEN** an operator needs to correct a mistaken credit
- **THEN** a compensating `adjustment` entry is inserted and the original row remains unchanged

### Requirement: Idempotent ledger writes
Every ledger insert SHALL carry a deterministic `idempotency_key` unique per logical money event
(`sale_<chargeId>_<photographerId>`, `withdrawal_<transferId>`,
`refund_<chargeId>_<photographerId>`), enforced by a UNIQUE constraint, and inserts SHALL be
`on conflict do nothing` so a webhook retry or duplicate delivery has zero effect on the balance.

#### Scenario: Webhook retry does not double-credit
- **GIVEN** a `payment_intent.succeeded` delivery already credited `sale_<ch_1>_<ph_A>`
- **WHEN** Stripe redelivers the same event and the handler runs again
- **THEN** the second insert conflicts on the idempotency key and the balance is unchanged

### Requirement: Ledger access control
`ledger_entries` SHALL have RLS enabled with a `select` policy limited to the photographer's own rows
(`photographer_id = auth.uid()`) and NO insert/update/delete policies for `anon` or `authenticated` —
all writes go through the service-role client from server-side money paths only.

#### Scenario: Photographer cannot forge a credit
- **WHEN** an authenticated user attempts to insert a `ledger_entries` row via the user-scoped client
- **THEN** the insert is rejected by RLS

#### Scenario: Photographer reads only their own entries
- **WHEN** an authenticated photographer selects from `ledger_entries`
- **THEN** only rows with their own `photographer_id` are returned

### Requirement: Ledger reconciliation and drift alert
A scheduled job SHALL periodically verify ledger self-consistency, re-drive stranded withdrawals
(active photographers holding a balance at or above the transfer minimum), and alert by email when the
platform Stripe balance is insufficient to cover the total pending ledger balance. The alert SHALL be
a no-op when the alert email env var is absent.

#### Scenario: Stranded balance is re-driven
- **GIVEN** a photographer is `active` with a ledger balance of 2000 cents (their activation withdrawal
  was missed)
- **WHEN** the reconciliation job runs
- **THEN** a withdrawal transfer is created for the balance and a matching `withdrawal` entry is
  recorded

#### Scenario: Drift alert fires
- **GIVEN** the total pending ledger balance exceeds the platform's available Stripe balance
- **WHEN** the reconciliation job runs and the alert email env var is set
- **THEN** an alert email is sent identifying the shortfall
