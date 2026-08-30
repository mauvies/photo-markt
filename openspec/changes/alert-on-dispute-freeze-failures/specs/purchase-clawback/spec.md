## ADDED Requirements

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
