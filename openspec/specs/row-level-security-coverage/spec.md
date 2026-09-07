# row-level-security-coverage Specification

## Purpose

Every table in `public` grants all privileges to `anon` and `authenticated`, so RLS is the only thing
between an unauthenticated request and the data. This capability makes that barrier measurable: each
table declares the posture it is meant to have, the suite proves the barrier actually holds, and a
table added without a declaration fails the build rather than quietly shipping untested.

## Requirements

### Requirement: Every table in `public` declares a tested RLS posture

The system SHALL maintain an inventory test enumerating every table in the `public` schema from the
live catalog and requiring each one to be declared, with a reason, as either **policy-protected** (it
has policies and behavioural tests) or **total denial** (RLS enabled with no policies, service-role
only).

The inventory SHALL assert that nothing undeclared is present, rather than that everything declared
exists, because the local schema and production have drifted before.

#### Scenario: A new table is added without a declaration

- **WHEN** a migration adds a table to `public` and the inventory allow-list is not updated
- **THEN** the inventory test fails, naming the undeclared table

#### Scenario: A table ships without RLS

- **WHEN** any table in `public` has row-level security disabled
- **THEN** the inventory test fails, independently of any allow-list

#### Scenario: A policy is written as permissive-to-all

- **WHEN** any policy's expression is a bare `true`
- **THEN** the inventory test fails

### Requirement: RLS is exercised from the perspectives it defends against

For every policy-protected table, the system SHALL prove, using a client that carries the relevant
identity rather than the service role, that an unauthenticated caller reads nothing it must not read
and that an authenticated caller cannot read or write another user's rows.

Seeding SHALL be done with the service role and verification SHALL be done with an anon or
user-scoped client, since the service role bypasses RLS and would make such a test pass vacuously.
Each area SHALL also assert a positive control: the legitimate path still works.

#### Scenario: Another user's rows are invisible

- **WHEN** a user reads a table containing another user's rows
- **THEN** only their own rows come back

#### Scenario: Writing another user's row is refused

- **WHEN** a user attempts to insert, update or delete a row belonging to someone else
- **THEN** the write is refused or matches nothing
- **AND** re-reading with the service role shows the row unchanged

#### Scenario: A table with RLS and no policies denies everyone

- **WHEN** an anon or authenticated caller reads or writes a total-denial table, even a row keyed to
  their own id
- **THEN** they receive no rows and no write takes effect
- **AND** the service role can still read and write it

#### Scenario: Public visibility that is intentional is pinned

- **WHEN** a policy deliberately exposes rows to unauthenticated callers — face and bib rows belonging
  to a public, non-deleted event
- **THEN** a test asserts both sides of that condition, so the exposure is a recorded decision rather
  than a later discovery

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

### Requirement: The API roles hold no privilege that bypasses RLS

The system SHALL NOT grant `TRUNCATE` to `anon` or `authenticated` on any table in `public`, because
`TRUNCATE` is not subject to row-level security, and SHALL apply the same restriction to tables
created later.

#### Scenario: No API role can truncate

- **WHEN** the inventory checks table privileges for `anon` and `authenticated`
- **THEN** no table in `public` grants either role `TRUNCATE`

#### Scenario: A future table does not re-arm it

- **WHEN** a migration creates a new table in `public`
- **THEN** it does not grant `TRUNCATE` to the API roles by default

### Requirement: Dead profile columns are removed rather than protected

Where a profile column has no reader, no writer and no interface, the system SHALL drop it rather
than carry it behind an access rule. A column that holds sensitive data and serves no purpose is a
liability with no offsetting benefit, and the safest state for such data is not to exist.

#### Scenario: The abandoned payout-design columns are gone

- **WHEN** the profile schema is inspected after the change
- **THEN** the columns of the superseded manual payout design — its method, its bank-details document
  and the unused processor customer reference — no longer exist
- **AND** no application code referenced them beforehand
