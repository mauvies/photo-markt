## Why

The schema carries an archaeological layer that every audit re-discovers and nobody removes, and it
is not inert. `payment_accounts` still stores photographer bank/PayPal details in a `jsonb` column
(`supabase/migrations/20250218000001_add_payment_accounts.sql:17`) with zero callers in `src/` —
a privacy liability with no product behind it. `events.organizer_fee_per_photo_cents` is written by a
**live** create-wizard field whose copy promises *"Charged on top of the platform fee whenever a
contributor's photo sells"* (`src/dictionaries/en.json:1119`) while no money path reads it. And
`profiles.is_admin` is a column named like an authorization gate that gates nothing — real
authorization is `admin_users` — which is exactly how a future contributor builds a bypass in good
faith.

Doing it now unblocks T-227 (RLS test coverage): there is no point writing RLS tests for tables that
are about to disappear.

## What Changes

- **BREAKING (schema):** one migration drops the dead tables `payment_accounts`,
  `ai_search_profiles`, `ai_search_usage`, `time_sync_tokens`, `upload_batches`, `upload_objects`;
  the columns `payouts.payment_account_id`, `events.{start_date,end_date,time_offset,
  time_sync_enabled,organizer_fee_per_photo_cents}` and `profiles.is_admin`; the orphaned trigger
  functions `set_payment_accounts_updated_at`, `set_ai_search_profiles_updated_at`,
  `set_photo_embeddings_updated_at`; the zero-caller RPC `search_user_by_email(text)`; and the
  `vector` extension. Every statement is `if exists` — the migration set does not fully describe
  production.
- **BREAKING (UI):** the organizer fee-per-photo field is removed from the event-creation wizard
  end to end, together with its two dictionary strings. This is the explicit decision T-219 demands:
  the field collected a number that moved no money, so the honest fix is to stop asking for it.
  Building the real organizer revenue split is a separate feature, captured as a follow-up ticket.
- `src/database/queries/payment-accounts.ts` (226 LOC) is deleted along with its `index.ts` export
  and its integration test; `Payout.payment_account_id` and `Event.organizer_fee_per_photo_cents`
  leave their interfaces.
- A new source-level regression test stops the whole layer coming back — including a guard that no
  `is_admin` check may reappear in `src/`.
- `scripts/advisors-baseline.ts` keeps its entries for the dropped artifacts, with rewritten reasons.
  The gate runs against **staging**, which does not receive this migration until merge, so pruning an
  entry now would turn a still-reported finding into an undeclared one and fail CI.

## Capabilities

### New Capabilities
- `dead-schema-pruning`: what counts as dead schema here, how it is removed (idempotent `if exists`
  drops), and the standing invariant that the removed artifacts — above all an `is_admin`
  authorization check — may not return.

### Modified Capabilities
<!-- None. No existing spec's requirements change: the organizer fee is read by no money path, so
     photo-bundle-pricing / photographer-payout-ledger / buyer-service-fee behaviour is untouched.
     The bundle-pricing rationale that *mentions* the column is documentation, corrected in place. -->

## Impact

- **Database:** `supabase/migrations/20260820000000_prune_dead_schema.sql`. Applied by
  `.github/workflows/migrate.yml` on merge to main — a workflow that has failed on an exhausted
  Actions budget before, leaving main live against an un-migrated database. Confirm it went green or
  apply by hand.
- **Query layer:** `src/database/queries/{payment-accounts.ts (deleted),index.ts,payouts.ts,events.ts}`
- **Event creation:** `src/app/[lang]/dashboard/photographer/events/new/` — `actions.ts`,
  `wizard.schema.ts`, `wizard-types.ts`, `wizard-storage.ts`, `wizard.tsx`, `steps/step-1-type.tsx`,
  `steps/step-3-details.tsx`
- **i18n:** `organizerFeeLabel` / `organizerFeeDesc` removed from both dictionaries
- **CI gate:** `scripts/advisors-baseline.ts` reasons rewritten (entries retained on purpose)
- **Tests:** new `test/unit/database/dead-schema-pruned.test.ts`; deleted
  `test/integration/queries/payment-accounts.test.ts`; `search_user_by_email` cases removed from
  `test/integration/security/security-definer-rpcs.test.ts`; organizer-fee form data removed from
  `test/unit/wizard-storage.test.ts`, `test/integration/actions/{bundle-tiers,watermark-policy}.test.ts`
- **Docs:** `CLAUDE.md` and `ARCHITECTURE.md` in the same PR
- **Rollback is inert:** reverting the code needs no down-migration — nothing reads the dropped
  artifacts. The dropped rows are not recoverable, which is accepted (Stripe Connect superseded them).
