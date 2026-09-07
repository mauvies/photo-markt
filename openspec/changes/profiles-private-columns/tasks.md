# Tasks — profiles-private-columns (T-268)

## 1. Migration

- [ ] 1.1 New migration: drop the six dead columns (`payout_method`, `payout_details_json`,
      `stripe_customer_id`, `default_city`, `default_country`, `default_province`), with the
      evidence for each in the header.
- [ ] 1.2 Drop `photographer_profiles_public_select`; create `public.public_profiles` (owner rights,
      NO `security_invoker`) selecting the public columns, filtered to photographer rows; grant
      SELECT on it to `anon` and `authenticated`.
- [ ] 1.3 `revoke select, insert, update, delete on public.profiles from anon` — it reads the view
      now, so T-227's column grants are withdrawn.
- [ ] 1.4 `revoke insert, update on public.profiles from authenticated` + column grants for the
      editable set only (`stripe_connect_account_id` / `stripe_connect_status` withheld).

## 2. Application changes

- [ ] 2.1 Repoint at `public_profiles`: `getPhotographerBySlug`, `getTopPhotographers`,
      `searchPhotographers` (`queries/photographers.ts`) and the photographer filter in
      `searchPublicEvents` (`queries/events.ts`). Leave the talent-side search on `profiles` with a
      comment saying why (it must not filter `active_role`).
- [ ] 2.2 Move to `supabaseAdmin`: `connectStripeAccountAction`
      (`settings/payout-profile/actions.ts:110`) and the three `reconcileAndPersistConnectStatus`
      callers that pass the user client (`photographer/page.tsx`, `events/[id]/page.tsx`,
      `settings/payout-profile/page.tsx`).
- [ ] 2.3 `updateProfile`: filter to known keys at runtime before the write.
- [ ] 2.4 Remove the dropped columns from `Profile`, `ProfileSelect` and `updateProfile`'s key union.

## 3. Seed

- [ ] 3.1 Replace T-227's `profiles` block in `supabase/seed.sql` with the full new posture
      (anon revoke; authenticated revoke + column grants), kept idempotent.

## 4. Tests

- [ ] 4.1 Invert both `KNOWN GAP` tests in `profiles-rls.test.ts`: a foreign user reads nothing, and
      the owner cannot write `stripe_connect_*`. Both fail before the migration and pass after.
- [ ] 4.2 New: the view serves the public columns to anon and to a signed-in stranger; the view
      exposes no private column; the owner still reads their own full row and edits name/bio/address
      (positive controls).
- [ ] 4.3 Inventory test: declare `public_profiles`; replace the anon-column assertion on `profiles`
      with the view's column set plus the writable-column set for `authenticated`; drop the
      `stripe_customer_id` seed.

## 5. Docs and gates

- [ ] 5.1 CLAUDE.md: the `profiles` bullet becomes the new posture — view = read allow-list, column
      grants = write allow-list, `profiles` self-only.
- [ ] 5.2 `backlog/DECISIONS.md` §10: why a view and not a private table (a private table would mix
      user-editable with system-managed columns and need splitting in two).
- [ ] 5.3 `pnpm db:reset`, the anon/foreign-user `curl` probes both ways, and the `PATCH` probe.
- [ ] 5.4 `pnpm typecheck && pnpm lint && pnpm test` + `pnpm build` (queries layer is touched).
- [ ] 5.5 `/code-review high` AND the 3 refutation subagents (money-adjacent: this changes who may
      write the transfer destination).
