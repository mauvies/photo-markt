# Tasks — rls-coverage-and-profile-exposure (T-227)

## 1. Shared catalog helper

- [x] 1.1 Create `test/helpers/db-catalog.ts` with `resolveDbContainer`, `queryJson`, `execSql`
      moved verbatim from `test/integration/security/security-definer-rpcs.test.ts` (keep the
      header rationale: supabase-js cannot run arbitrary SQL, `psql` is not on the host PATH).
- [x] 1.2 Re-point `security-definer-rpcs.test.ts` at the helper; no behaviour change, suite still
      green.
- [x] 1.3 Add `photos_orphan_storage_pending_cleanup` to `resetDatabase`'s explicit delete list in
      `test/helpers/supabase-test-client.ts` — it does not cascade from `auth.users` and would leak
      between tests.

## 2. The fix: migration + seed

- [x] 2.1 New migration: `revoke select on public.profiles from anon` + `grant select (id, username,
      slug, display_name, bio, avatar_url, city, country_code, created_at, active_role)` to `anon`.
      Idempotent, additive, rollback-inert.
- [x] 2.2 Same migration: `revoke truncate, references, trigger on all tables in schema public from
      anon, authenticated` + the matching `alter default privileges … revoke` so a future table
      cannot re-arm it.
- [x] 2.3 Update `supabase/seed.sql` to re-apply the profiles posture after its blanket grant, kept
      idempotent, so local and production agree.

## 3. Inventory test

- [x] 3.1 `test/integration/security/rls-table-inventory.test.ts`: allow-list of all 26 tables as
      `policies-tested` | `total-denial` with a reason each; `expected` built from the keys of
      `actual` with a sentinel for undeclared tables; one `toEqual`.
- [x] 3.2 Allow-list-free properties: every `public` table has RLS enabled; no policy expression is a
      bare `true`; neither `anon` nor `authenticated` holds TRUNCATE on any table.

## 4. Behavioural RLS tests (19 tables)

- [x] 4.1 `profiles-rls.test.ts` — the regression: anon requesting `full_name` / `address_line1` /
      `postal_code` / `stripe_connect_account_id` / `payout_details_json` is refused (fails before
      2.1, passes after); anon requesting `getPhotographerBySlug`'s exact column list still works
      (positive control); a user still reads their own full profile; and the still-open
      `authenticated` half is pinned with a comment declaring it a known gap.
- [x] 4.2 `events-photos-rls.test.ts` — events, photos, photo_faces, photo_bib_numbers, covering
      both sides of the `is_public` branch and the `deleted_at IS NULL` guard.
- [x] 4.3 `cart-rls.test.ts` (carts, cart_items) and `order-items-rls.test.ts` — the one-hop
      ownership shape via `carts.user_id` / `orders.user_id`.
- [x] 4.4 `event-photographers-rls.test.ts` and `talent-photo-tags-rls.test.ts` — two owners each
      (event owner vs invitee; photographer vs tagged talent).
- [x] 4.5 `roles-rls.test.ts` (user_roles, user_role_memberships) — pin that self-grant is bounded by
      the role enum, not by RLS.
- [x] 4.6 `misc-rls.test.ts` — feedback, roadmap_votes, download_tokens.
- [x] 4.7 `total-denial-rls.test.ts` — the 7 zero-policy tables in one table-driven loop: anon and a
      foreign authenticated client get nothing, writes take no effect, service role still works.

## 5. Docs and gates

- [x] 5.1 CLAUDE.md security conventions: the table inventory as sibling gate to the SECURITY DEFINER
      one, and the durable rule that `profiles` is read by `anon` through an explicit column
      allow-list — a new public column must be added to the grant, a sensitive one never is.
- [x] 5.2 `backlog/DECISIONS.md` §10: what leaked, how it was verified, why the `authenticated` half
      is split out, why the seed has to repeat the grant, and that the advisors gate has no
      table-privilege rule so it could never have caught this.
- [x] 5.3 File the follow-up ticket for the `authenticated` half via `/ticket`.
- [x] 5.4 `pnpm db:reset` (proves the posture survives the seed), then the anon `curl` probe both
      ways, then `pnpm typecheck && pnpm lint && pnpm test`.
- [x] 5.5 Riesgo alto ⇒ `/code-review high` on the diff before committing; fix the real findings.
