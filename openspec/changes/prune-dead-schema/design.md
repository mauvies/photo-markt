## Context

T-219 (`Riesgo: alto` — DB/migraciones). The plan recorded here was approved in plan mode before this
document was written; this is a transcription, not a fresh design.

Verified against the code and against a real project snapshot, not against the docs:

- `payment_accounts` and `ai_search_profiles` are **live**: their `set_*_updated_at` trigger functions
  appear in `scripts/advisors-baseline.ts:88,89`, which is a snapshot of the staging project.
- `ai_search_usage` (`supabase/migrations/20260622000000_drop_ai_search_usage_quota.sql`) and
  `profiles.is_admin` (`20260513000000_move_is_admin_to_admin_users.sql:31`) **already have drop
  migrations**. The ticket's inventory is stale on those two — it reads the create migrations. They
  stay in the new migration anyway, `if exists`, because the migration set is known not to describe
  production completely.
- `createPayout` is already gone (T-220). What survives is `Payout.payment_account_id`
  (`src/database/queries/payouts.ts:29`), declared and written by nothing.
- `payouts.admin_notes` **is** live — `voidHoldsForCharge` writes it
  (`src/database/queries/payouts.ts:401`). Not pruned.
- `upload_batches` / `upload_objects` (`supabase/migrations/20260427162800_remote_schema.sql:313,330`)
  are **not** in the ticket's table but are the same class as `time_sync_tokens`: zero references in
  `src/`, still carrying `anon` DML grants. Included.
- `scripts/advisors-baseline.ts` nominates two further artifacts for this ticket **by name**:
  `search_user_by_email` ("zero callers, dropped in T-219", line 144) and the `vector` extension
  ("drop it with the dead schema in T-219", line 118). Included.

## Goals / Non-Goals

**Goals:**
- One idempotent migration removes the dead layer; the code that only served it goes with it.
- The removals are pinned by a source-level regression test, with `is_admin` as the headline guard.
- `CLAUDE.md` and `ARCHITECTURE.md` stop describing tables that no longer exist.
- CI stays green on both sides of the merge boundary.

**Non-Goals:**
- Organizer revenue sharing. Removing the field is the honest half of the decision T-219 demands;
  building the split is a feature with payout and tax implications, captured as a follow-up ticket.
- RLS test coverage for the surviving tables — that is T-227, which this change unblocks.
- Pinning `search_path` on the remaining trigger functions (a separate baseline entry, still deferred).

## Decisions

**Every drop is `if exists`; the extension drop is not `cascade`.**
`if exists` is required by the environment drift this repo has repeatedly hit — a migration edited
after being applied never re-runs, so environments legitimately disagree about which artifacts exist.
`drop extension if exists vector` is deliberately written **without** `cascade`: after
`20260518000000` the only surviving `vector`-typed column is on `ai_search_profiles`, which this same
migration drops first. If that reasoning is wrong, the migration fails loudly instead of silently
cascading into a table somebody still uses. Alternative rejected: `cascade`, which would convert a
wrong assumption into invisible data loss.

**Baseline entries are retained with rewritten reasons, not pruned.**
`.github/workflows/supabase-advisors.yml` is path-gated on `supabase/migrations/**`, so it *will* run
on this PR — against **staging**, which does not receive the migration until merge. `diffAdvisors`
(`scripts/supabase-advisors.ts`) fails the build on *undeclared* blocking findings and merely reports
*stale* ones. Removing an entry now would therefore turn a still-reported WARN into a build failure.
Keeping the entry and rewriting its reason to name the migration is green before the merge and
harmless (reported-as-stale) after it. Alternative rejected: pruning in this PR and accepting a red
gate until merge.

**`profiles.is_admin` is guarded by a test, not only by a drop.**
The column is very likely already gone in every environment. The failure mode T-219 names is not the
column existing — it is a future contributor writing `if (profile.is_admin)` because the name reads
like a gate. A `drop column` cannot prevent that; a source-level assertion over `src/` can. This is
the acceptance criterion's "documentada y con un test que impida usarla para autorizar", satisfied
alongside the drop rather than instead of it.

**The regression test is source-level, following T-202 / T-220.**
`test/unit/api/dead-billing-routes-removed.test.ts` established the shape: what must not come back is
the *file* and the *identifier*, and a runtime probe proves nothing in a unit run. The test also
asserts the migration file still exists and drops each named artifact — otherwise deleting the
migration would silently un-prune the schema on the next environment rebuild while every other
assertion stayed green.

**The organizer fee is removed from the UI, not merely from the DB.**
Dropping the column while leaving the input would leave the wizard collecting a number it discards.
The copy is an active false promise — *"Charged on top of the platform fee whenever a contributor's
photo sells"* — so the field, its validator, its draft persistence, its review row and both
dictionary strings go together. The `/edit` form never exposed the field, which is itself evidence
the feature was abandoned mid-build.

**`search_user_by_email` loses its inventory entry, not just its definition.**
`test/integration/security/security-definer-rpcs.test.ts` enumerates every `SECURITY DEFINER`
function in `public` and fails on any not declared in `EXPECTED_EXPOSURE`. Removing the entry is what
makes the inventory layer fail if the function ever returns; its two behavioural cases go with it.

## Risks / Trade-offs

- **Dropped rows are unrecoverable** → Accepted deliberately. `payment_accounts` is superseded by
  Stripe Connect (`profiles.stripe_connect_account_id`), has zero readers, and holding unused
  bank/PayPal details is itself the larger risk.
- **`migrate.yml` can fail on an exhausted Actions budget, leaving main live against an un-migrated
  database** → This has happened before. The code tolerates both states (nothing reads the dropped
  artifacts), so the failure mode is a stale schema, not a broken app. Post-merge step: confirm the
  job went green or apply the migration by hand.
- **Prod may carry artifacts staging does not** → `if exists` covers exactly this; the migration is
  correct in either world.
- **`drop extension vector` could fail on an unknown dependent in prod** → Chosen over `cascade` on
  purpose: a failed migration is recoverable and visible, a silent cascade is neither.
- **Existing organizer events keep whatever fee their owners typed, and it is destroyed** → Accepted.
  The value never affected a payout, and a future revenue-split feature would re-collect it against a
  real design rather than inherit a number entered under a false description.

## Migration Plan

1. `pnpm db:reset` locally — rebuilds from every migration in order; the real proof the drop applies
   cleanly and that `drop extension vector` has no surviving dependent.
2. `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm build` (mandatory here:
   `src/database/queries/` is touched, and only the bundle catches server-only code reaching the
   client graph).
3. Merge → `migrate.yml` applies the migration to the remote databases. **Verify the job went green.**
4. Once applied to staging, the four retained baseline entries become stale — prune them in a
   follow-up.

**Rollback:** revert the code; no down-migration. Nothing reads the dropped artifacts, so a pruned
database serves the reverted code unchanged.

## Open Questions

None. The three decisions the ticket left open — organizer fee, `payment_accounts` data, adjacent
baseline scope — were settled before implementation: remove the field and drop the column; drop the
table and the `payouts` column; include all three adjacent artifacts.
