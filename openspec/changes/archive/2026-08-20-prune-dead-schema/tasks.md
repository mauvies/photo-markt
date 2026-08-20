## 1. Regression test first (must fail before the removals)

- [x] 1.1 Add `test/unit/database/dead-schema-pruned.test.ts` in the shape of
      `test/unit/api/dead-billing-routes-removed.test.ts`: assert `src/database/queries/payment-accounts.ts`
      is absent and `index.ts` does not export it; no `from('payment_accounts')`,
      `from('ai_search_profiles')`, `from('time_sync_tokens')`, `from('upload_batches')` or
      `from('upload_objects')` anywhere under `src/`; no `organizer_fee_per_photo_cents` and no
      `payment_account_id` under `src/`
- [x] 1.2 Add the `is_admin` guard to that file — no reference under `src/`, failure message naming
      `admin_users` as the real gate — plus a positive assertion that the admin status page still
      gates on `admin_users`, so the deletion cannot be widened
- [x] 1.3 Add the migration-presence assertion: the pruning migration exists and drops each named
      artifact
- [x] 1.4 Run `pnpm vitest run test/unit/database/dead-schema-pruned.test.ts` and confirm it FAILS

## 2. Migration

- [x] 2.1 Write `supabase/migrations/20260820000000_prune_dead_schema.sql` with a header comment
      linking T-219 and stating why each artifact is dead
- [x] 2.2 `drop table if exists ... cascade`: `payment_accounts`, `ai_search_profiles`,
      `ai_search_usage`, `time_sync_tokens`, `upload_batches`, `upload_objects`
- [x] 2.3 Drop `payouts.payment_account_id` and its index; drop `events.{start_date,end_date,
      time_offset,time_sync_enabled,organizer_fee_per_photo_cents}`; drop `profiles.is_admin`
- [x] 2.4 `drop function if exists`: `set_payment_accounts_updated_at`,
      `set_ai_search_profiles_updated_at`, `set_photo_embeddings_updated_at`,
      `search_user_by_email(text)`
- [x] 2.5 `drop extension if exists vector` — no `cascade`, on purpose (see design.md)
- [x] 2.6 `pnpm db:reset` and confirm every migration applies cleanly

## 3. Query layer

- [x] 3.1 Delete `src/database/queries/payment-accounts.ts` and its `export *` line in `index.ts`
- [x] 3.2 Remove `payment_account_id` from the `Payout` interface (`payouts.ts`)
- [x] 3.3 Remove `organizer_fee_per_photo_cents` from the `Event` interface, from `createEvent`'s
      params and insert payload, and from the organizer-event error-message regex (`events.ts`)

## 4. Organizer-fee field removal

- [x] 4.1 `events/new/actions.ts`: drop the zod field, the `formData.get`, and `organizerFeeCents`
- [x] 4.2 `wizard.schema.ts`, `wizard-types.ts`, `wizard-storage.ts`: drop the field from the schema,
      the defaults and the draft round-trip
- [x] 4.3 `wizard.tsx`: drop the `formData.append` block and the review row
- [x] 4.4 `steps/step-1-type.tsx`: drop the field reset; `steps/step-3-details.tsx`: drop the whole
      `form.Subscribe` block that renders the input
- [x] 4.5 Remove `organizerFeeLabel` / `organizerFeeDesc` from `en.json` and `es.json`
- [x] 4.6 Reword the organizer-exclusion rationale in `src/lib/bundle-pricing.ts` to the reason that
      survives (one event, several sellers)

## 5. Existing tests

- [x] 5.1 Delete `test/integration/queries/payment-accounts.test.ts`
- [x] 5.2 `test/integration/security/security-definer-rpcs.test.ts`: remove the
      `search_user_by_email` entry from `EXPECTED_EXPOSURE` and its two behavioural cases
- [x] 5.3 Remove `organizer_fee_per_photo` from `test/unit/wizard-storage.test.ts` and from the
      form data in `test/integration/actions/{bundle-tiers,watermark-policy}.test.ts`
- [x] 5.4 Re-run the new regression test and confirm it now PASSES

## 6. CI gate and docs

- [x] 6.1 `scripts/advisors-baseline.ts`: keep the entries for `set_payment_accounts_updated_at`,
      `set_ai_search_profiles_updated_at`, `extension_in_public:public.vector` and
      `search_user_by_email`; rewrite each reason to name the migration and say "prune once applied
      to staging". Do NOT delete them — see design.md
- [x] 6.2 `CLAUDE.md`: drop `payment-accounts.ts` from the query-layer list, remove
      `organizer_fee_per_photo_cents` from the `events` column list and its two explanatory bullets,
      delete the ghost-columns bullet and the **payment_accounts** / **ai_search_profiles** sections,
      and strengthen the `is_admin` line to say a test now enforces it
- [x] 6.3 `ARCHITECTURE.md`: drop `ai_search_profiles`, `ai_search_usage`, `time_sync_tokens` from
      the table inventory, the FK list and the RLS list

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm test`
- [x] 7.2 `pnpm build` (mandatory — `src/database/queries/` is touched)
- [ ] 7.3 Create an organizer event through the wizard and confirm the flow is intact without the
      removed field — ⚠️ **needs the user**: the wizard is behind Google OAuth, which the agent
      cannot sign into. Server-side organizer creation IS covered by
      `test/integration/actions/watermark-policy.test.ts` (green)
- [x] 7.4 `/code-review` on the diff and fix the real findings (`Riesgo: alto`) — fixed: cleared the
      `vector` extension's known dependents defensively before dropping it, corrected the comment
      that claimed a failure there "fails loudly" (migrate.yml runs `psql -f` with no
      `ON_ERROR_STOP` and records the version anyway), and reworded a stale organizer-fee comment
      in `step-3-details.tsx`

## 8. Before merging (needs the user)

- [ ] 8.1 ⚠️ Run `select count(*) from payment_accounts;` against **production**. The drop is
      irreversible and the table holds photographer bank/PayPal details — "rollback is inert" is
      true of the code, not of the data. Export first if the count is non-zero and the rows are
      wanted; otherwise the deletion is the point (they are unused and a privacy liability)
- [ ] 8.2 After merge, confirm `migrate.yml` went green **and** that `vector` is actually gone —
      a green job does not prove the migration succeeded (see 7.4)
- [ ] 8.3 Follow-up tickets worth filing: organizer revenue sharing (the feature the removed field
      pretended to be); `ON_ERROR_STOP` in `migrate.yml`; `git rm --cached -r supabase/.temp`
      (nine gitignored files are still tracked and re-dirty on every CLI run)
