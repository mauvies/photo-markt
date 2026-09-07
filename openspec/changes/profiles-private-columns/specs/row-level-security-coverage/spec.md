## MODIFIED Requirements

### Requirement: A public read policy exposes only the columns it means to

Where profile data is readable by callers other than its owner, the system SHALL serve it through a
dedicated public projection whose column list is the allow-list, and the underlying table SHALL admit
only the caller's own row. Row-level security cannot restrict columns, so a policy that admits
another user's row exposes every column of it — including any column added later.

The projection SHALL NOT widen who is visible relative to the policy it replaces, and its column list
SHALL be reproduced wherever local database provisioning re-applies blanket grants, so the local
posture and the deployed posture cannot disagree.

#### Scenario: Another user's private profile data is unreadable

- **WHEN** any caller other than the owner — unauthenticated or signed in — requests a profile's legal
  name, postal address, payment processor identifiers or payout details
- **THEN** the request returns nothing or is refused, for every role

#### Scenario: The public projection serves the public profile

- **WHEN** an unauthenticated or signed-in caller reads the public projection for a photographer
- **THEN** it returns the columns the public profile and the photographer search use

#### Scenario: The public projection carries no private column

- **WHEN** the projection's columns are enumerated
- **THEN** none of the private profile columns appears in it

#### Scenario: A user can still read their own full profile

- **WHEN** an authenticated user reads their own profile, including the private columns
- **THEN** the read succeeds

#### Scenario: Local provisioning does not restore the exposure

- **WHEN** the local database is reset, re-running migrations and the seed
- **THEN** the restriction is still in force

### Requirement: System-managed profile columns are not writable by the user

The system SHALL prevent a user from writing the profile columns it treats as system-managed — the
payout destination and its status — even on their own row, and SHALL keep those writes on paths that
derive their value from the payment processor rather than from user input.

A row-level policy is not sufficient: it restricts which row may be written, not which columns, so
the restriction SHALL be expressed at the column level AND enforced again in the query layer, which
holds even if a grant is later relaxed.

#### Scenario: A user cannot rewrite their own payout destination

- **WHEN** a signed-in photographer attempts to write their own payout account id or connect status
  directly
- **THEN** the write is refused

#### Scenario: A user can still edit their own editable fields

- **WHEN** a signed-in user updates their display name, bio or postal address
- **THEN** the write succeeds

#### Scenario: An unfiltered update object cannot reach a protected column

- **WHEN** a request supplies extra keys to a profile-updating action beyond the fields it declares
- **THEN** the extra keys are dropped before the write, independently of database privileges

#### Scenario: Connect onboarding still records the account

- **WHEN** a photographer completes Stripe Connect onboarding, or a page reconciles a stale connect
  status against the payment processor
- **THEN** the resulting status is still persisted

## ADDED Requirements

### Requirement: Dead profile columns are removed rather than protected

Where a profile column has no reader, no writer and no interface, the system SHALL drop it rather
than carry it behind an access rule. A column that holds sensitive data and serves no purpose is a
liability with no offsetting benefit, and the safest state for such data is not to exist.

#### Scenario: The abandoned payout-design columns are gone

- **WHEN** the profile schema is inspected after the change
- **THEN** the columns of the superseded manual payout design — its method, its bank-details document
  and the unused processor customer reference — no longer exist
- **AND** no application code referenced them beforehand
