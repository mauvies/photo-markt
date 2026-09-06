## ADDED Requirements

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

Where a table is readable by unauthenticated callers, the system SHALL restrict what they may read to
an explicit column allow-list, because row-level security cannot restrict columns and a policy
selecting a row therefore exposes every column of it.

The allow-list SHALL be reproduced wherever local database provisioning re-applies blanket grants, so
that the local posture and the deployed posture cannot disagree.

#### Scenario: Sensitive profile columns are not readable by an unauthenticated caller

- **WHEN** an unauthenticated caller requests a photographer's legal name, postal address, payment
  processor identifiers or payout details
- **THEN** the request is refused

#### Scenario: The public profile still renders

- **WHEN** an unauthenticated caller requests the columns the public photographer profile and the
  photographer search actually use
- **THEN** the request succeeds and returns the row

#### Scenario: A user can still read their own full profile

- **WHEN** an authenticated user reads their own profile, including the withheld columns
- **THEN** the read succeeds

#### Scenario: Local provisioning does not restore the exposure

- **WHEN** the local database is reset, re-running migrations and the seed
- **THEN** the column restriction is still in force

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
