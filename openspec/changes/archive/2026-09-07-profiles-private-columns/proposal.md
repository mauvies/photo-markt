# T-268 · Close the `profiles` read and write gaps T-227 left open

## Why

T-227 closed the `anon` half of the `profiles` exposure with column-level SELECT grants and
deliberately left two halves open, each pinned by a `KNOWN GAP` test:

1. **Read.** `photographer_profiles_public_select` is `USING (active_role = 'PHOTOGRAPHER')` and RLS
   is row-level, so **any signed-in account** — a Google sign-up takes seconds — reads any
   photographer's legal name, postal address, Stripe ids and payout-details jsonb.
2. **Write.** That allow-list is SELECT only. `profiles_self_update` restricts the row
   (`id = auth.uid()`) but not the columns, so a photographer can `PATCH` their own
   `stripe_connect_account_id` / `stripe_connect_status` — the transfer destination — straight
   through PostgREST, bypassing the app.

Exploring the call graph surfaced a third, independent vector: `updatePayoutProfileAction`
(`settings/payout-profile/actions.ts:35`) passes its client-supplied argument **unfiltered** into
`.update()`. TypeScript's `Pick<>` is erased at runtime, so a hand-crafted Server Action request can
already write any column, including `stripe_connect_account_id`, whatever the grants say.

## What Changes

- **BREAKING (deliberate):** `photographer_profiles_public_select` is dropped. `profiles` becomes
  self-only — no policy admits another user's row, for any role. The read exposure closes for `anon`
  and `authenticated` at once, structurally rather than by column list.
- A new `public.public_profiles` **view** carries the public projection (id, username, slug,
  display_name, bio, avatar_url, city, country_code, created_at, active_role), filtered to
  photographer rows so nothing widens. Created **without `security_invoker`** on purpose: it runs
  with owner rights, which is what lets it project rows the base table's RLS no longer exposes. Its
  select list IS the allow-list.
- `anon` loses all access to `profiles` and reads the view instead, so T-227's column grants become
  redundant and are withdrawn — one fewer list to keep in step.
- Four public read paths repoint at the view, all inside the query layer. Only one of them
  (`searchPhotographers`) used the user's client; the rest already used `supabaseAdmin`, which is why
  none of this touches the money path.
- **Writes:** `authenticated` loses table-wide INSERT/UPDATE on `profiles` and gets column grants for
  the user-editable set only. `stripe_connect_account_id` / `stripe_connect_status` become
  unwritable by the user, and the four call sites that write them with the user's client move to
  `supabaseAdmin`.
- `updateProfile` filters to known keys at runtime, closing the unfiltered-object vector regardless
  of what the grants say.
- **Six dead columns dropped** (`payout_method`, `payout_details_json`, `stripe_customer_id`,
  `default_city`, `default_country`, `default_province`): no reader, no writer, no UI, and four of
  them are not even in the TypeScript types. The first two hold bank details per their own migration
  comment. Same precedent as T-219, which dropped `payment_accounts` — the sibling of this same
  pre-Connect design.
- `supabase/seed.sql` reproduces the whole posture, because its blanket grant runs after the
  migrations and would otherwise undo all of it on every `db reset`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `row-level-security-coverage`: the profile read surface becomes a view-shaped allow-list rather
  than a column grant, `profiles` admits only the caller's own row, and the write surface gains its
  own allow-list.

## Impact

- New migration: drop policy, drop six columns, create the view, re-grant reads/writes. Additive and
  idempotent; rollback is inert (reverting the code needs no down-migration).
- `src/database/queries/photographers.ts` and `events.ts`: four reads repointed at `public_profiles`.
- `src/database/queries/profiles.ts`: runtime key filter in `updateProfile`, dead columns removed
  from `Profile` / `ProfileSelect` / the `updateProfile` key union.
- Four call sites move to `supabaseAdmin`: `settings/payout-profile/actions.ts` and the three
  `reconcileAndPersistConnectStatus` callers in photographer pages.
- `supabase/seed.sql`, `test/integration/security/profiles-rls.test.ts` (both KNOWN GAP tests invert),
  `rls-table-inventory.test.ts` (declares the view, asserts the new grant sets).
- Docs: CLAUDE.md security conventions, `backlog/DECISIONS.md` §10.
- The talent-side photographer search keeps reading `profiles` with `supabaseAdmin` and no
  `active_role` filter — deliberate and documented, since the view filters and would change it.
