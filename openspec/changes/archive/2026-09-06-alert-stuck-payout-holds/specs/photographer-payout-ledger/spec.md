## ADDED Requirements

### Requirement: A hold outstanding beyond its window is reported, never silently retried forever

The system SHALL periodically examine the payout ledger for rows that have been outstanding beyond
their window and report them through the money-incident channel. The retry worker's failure exits
deliberately never throw, so a hold whose every retry fails is invisible unless something surfaces
the state itself.

Two windows apply, measured from the row's creation (the last-update timestamp is re-stamped by
every failed retry and therefore measures the last attempt, not the age of the debt):

- A row the worker itself is failing to drain — a `transfer_failed` hold, or any row left
  `processing` — is stuck once it is older than the retry-stuck window (24 hours, ≈ 48 attempts).
- A hold waiting on an external condition — `connect_inactive`, `below_minimum` — is a legitimate
  state short-term and SHALL NOT be reported at the retry-stuck window, but becomes reportable once
  older than the long-outstanding window (30 days).

The report SHALL be raised under its own incident kind, SHALL aggregate the whole set into one
incident claimed at most once per rolling day, SHALL carry identifiers and amounts only (no buyer
PII), SHALL never instruct a manual transfer (the ledger remains the authority on what was paid),
and SHALL change nothing about what the worker pays or when.

#### Scenario: A transfer that fails on every retry

- **WHEN** a `transfer_failed` hold has been outstanding longer than the retry-stuck window because
  its transfer attempt fails or its recovery probe stays inconclusive on every pass
- **THEN** an operational incident is raised naming the affected rows and their total payable amount
- **AND** the row itself is left exactly as it was — still selected by the normal retry path

#### Scenario: A row wedged in `processing`

- **WHEN** a row has sat `processing` longer than the retry-stuck window — its batch re-drive keeps
  failing, its probe stays inconclusive, or its photographer has no Connect destination
- **THEN** it is included in the same aggregated incident

#### Scenario: The alert fires even when nothing is payable

- **WHEN** every outstanding hold belongs to photographers whose Connect account is no longer
  active, so the worker has nothing it can pay this pass
- **THEN** the stuck-hold report still runs and still raises the incident

#### Scenario: A fresh failure does not alert

- **WHEN** a hold's transfer fails but the row is younger than the retry-stuck window
- **THEN** no incident is raised — the alert is about a state, not about a failed attempt

#### Scenario: Debt waiting on an external condition

- **WHEN** a `connect_inactive` or `below_minimum` hold is younger than the long-outstanding window
- **THEN** it is not reported
- **WHEN** it grows older than the long-outstanding window
- **THEN** it is included in the aggregated incident

#### Scenario: Frozen rows belong to the dispute sweep

- **WHEN** a row carries a dispute-freeze mark
- **THEN** this report excludes it, whatever its age — the stale-freeze sweep owns that state under
  its own kind

#### Scenario: The report does not repeat every pass

- **WHEN** the sweep runs repeatedly while the same rows remain stuck
- **THEN** one aggregated incident is raised for the whole set at most once per rolling day

#### Scenario: A listing failure does not gate the money, but is itself reported

- **WHEN** reading the stuck set fails
- **THEN** the worker's paying steps run unaffected — the read error never propagates
- **AND** an incident of its own kind is raised stating that the CHECK is down rather than that a
  row is stranded, at most once per rolling day
- **AND** raising it cannot itself fail the run

#### Scenario: More rows match than the pass can list

- **WHEN** more rows match than the per-pass row cap
- **THEN** the incident states that its counts and total are a floor rather than the whole set, and
  names the cap
- **AND** the oldest rows are the ones listed
