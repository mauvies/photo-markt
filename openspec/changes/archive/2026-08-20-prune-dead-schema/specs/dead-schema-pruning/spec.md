## ADDED Requirements

### Requirement: Dead schema is removed idempotently

The migration that prunes dead schema SHALL guard every statement with `if exists`. The migration set
does not fully describe production — artifacts already dropped by an earlier migration may still be
live in one environment and absent in another — so the migration MUST apply cleanly against a
database in either state.

#### Scenario: Applied to a database that still carries every artifact
- **WHEN** the migration runs against a database where `payment_accounts`, `ai_search_profiles`,
  `time_sync_tokens`, `upload_batches`, `upload_objects`, `profiles.is_admin` and the ghost `events`
  columns all exist
- **THEN** each is dropped and the migration completes without error

#### Scenario: Applied to a database where earlier migrations already dropped some of them
- **WHEN** the migration runs against a database where `ai_search_usage` (dropped by
  `20260622000000`) and `profiles.is_admin` (dropped by `20260513000000`) are already absent
- **THEN** those statements are no-ops and the migration still completes without error

#### Scenario: Re-running the migration
- **WHEN** the migration is applied a second time to the same database
- **THEN** it completes without error and changes nothing

### Requirement: Rollback needs no down-migration

Reverting the application code that accompanies this change SHALL leave a pruned database fully
functional. No live read or write path may depend on any dropped artifact, so a code rollback MUST
NOT require restoring the schema.

#### Scenario: Code is reverted after the migration has been applied
- **WHEN** the accompanying code changes are reverted while the database stays pruned
- **THEN** event creation, the payout ledger, face search and checkout continue to work, because
  none of them read a dropped table, column, function or extension

### Requirement: An `is_admin` authorization check may not return

Platform-admin authorization SHALL be `admin_users`, looked up through `supabaseAdmin`. The
`profiles.is_admin` column is removed, and no source file under `src/` may reference `is_admin` —
a column with that name gates nothing, so a check against it is a bypass wearing the appearance of a
gate.

#### Scenario: A contributor adds an is_admin check
- **WHEN** any file under `src/` is changed to reference `is_admin`
- **THEN** the dead-schema regression test fails, naming `admin_users` as the real gate

#### Scenario: The live admin surface keeps its gate
- **WHEN** the admin service-status page is rendered for a user with no `admin_users` row
- **THEN** the page returns `notFound()`, unchanged by this pruning

### Requirement: Pruned modules and columns may not be reintroduced

The removed query module, table references and column references SHALL be pinned by a source-level
regression test, following the precedent of `test/unit/api/dead-billing-routes-removed.test.ts`
(T-202). A source-level assertion is used deliberately: what must not come back is the *file* and the
*identifier*, and a runtime probe proves nothing in a unit run.

#### Scenario: The payment-accounts query module is restored
- **WHEN** `src/database/queries/payment-accounts.ts` exists again, or `index.ts` re-exports it, or
  any file under `src/` queries `from('payment_accounts')`
- **THEN** the regression test fails

#### Scenario: A dropped column is referenced again
- **WHEN** any file under `src/` references `organizer_fee_per_photo_cents` or
  `payment_account_id`
- **THEN** the regression test fails

#### Scenario: The migration itself is deleted
- **WHEN** the pruning migration file is removed from `supabase/migrations/`
- **THEN** the regression test fails, rather than the schema silently un-pruning on the next
  environment rebuild

### Requirement: The wizard does not collect a fee that moves no money

The event-creation wizard SHALL NOT ask an organizer for a per-photo fee while no money path applies
one. The field, its validation, its draft persistence, its review row and its two dictionary strings
are removed together.

#### Scenario: Creating an organizer event
- **WHEN** a photographer selects the `organizer` event type and reaches the details step
- **THEN** no fee-per-photo input is shown, and the event is created successfully with no
  `organizer_fee_per_photo_cents` value

#### Scenario: Resuming a draft saved before the removal
- **WHEN** a locally persisted wizard draft containing `organizer_fee_per_photo` is restored
- **THEN** the unknown key is ignored and the draft loads without error

### Requirement: The advisors gate stays green across the merge boundary

`scripts/advisors-baseline.ts` runs against **staging**, which does not receive this migration until
merge. Baseline entries for artifacts this change drops SHALL be retained with rewritten reasons that
name the migration, and pruned only once the migration has been applied to staging. A stale entry is
reported and never fatal; an undeclared blocking finding fails the build.

#### Scenario: The gate runs on this pull request
- **WHEN** `pnpm advisors:check` runs against staging before the migration is applied
- **THEN** the findings for `set_payment_accounts_updated_at`,
  `set_ai_search_profiles_updated_at`, `search_user_by_email` and the `vector` extension are still
  declared, and the gate passes

#### Scenario: The gate runs after the migration reaches staging
- **WHEN** the same check runs after the migration is applied
- **THEN** those entries are reported as stale for pruning, and the gate still passes
