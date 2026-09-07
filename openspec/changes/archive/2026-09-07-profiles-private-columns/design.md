# Design — profiles-private-columns (T-268)

Transcription of the plan approved in-session (2026-09-06). Motivation in `proposal.md`.

## Context

`profiles` mixes three kinds of data behind one row-level policy: public profile fields, user-editable
private fields (legal name, postal address, `is_payout_profile_complete`) and system-managed fields
(`stripe_connect_account_id`, `stripe_connect_status`). RLS is row-level, so one policy that admits
the row admits all three kinds.

The census established where every column is read and written, and with which client — the fact that
decides the blast radius:

- Public reads: `getPhotographerBySlug`, `getTopPhotographers` and `searchPublicEvents`'s photographer
  filter already run on `supabaseAdmin`. **Only `searchPhotographers`** (the collaborator-invite
  dialog) reads other people's profiles with the user's client.
- Money-path reads (`getPhotographerConnectStatuses`, `getProfileByStripeConnectAccountId`) are all
  `supabaseAdmin` and all funnel through `src/database/queries/profiles.ts`.
- Writes of the Stripe columns with the user's client: `connectStripeAccountAction`
  (`payout-profile/actions.ts:110`, **no catch**) and three `reconcileAndPersistConnectStatus`
  callers whose write sits inside a `.catch()` that only logs.

## Goals / Non-Goals

**Goals:**
- No role can read another user's `profiles` row.
- The user cannot write the columns the app treats as system-managed, by any route.
- Remove the dead columns rather than protect them.

**Non-Goals:**
- Dropping `is_payout_profile_complete`. The census marks it vestigial — its only live reader is a
  cosmetic badge and its migration's "gates payout requests" claim is false today — but it drives
  visible UI, and removing visible behaviour does not belong in a security fix. Protected like the
  rest, flagged as a candidate for its own ticket.
- Changing the talent-side photographer search.
- De-duplicating the two identical self-select / self-update policies (annotated in T-227, still out
  of scope).

## Decisions

1. **A view, not a private table.** The ticket proposed moving the private columns out. The census
   killed that: such a table would hold user-editable fields (address, `full_name`) next to
   system-only fields (`stripe_*`), so a self-write policy on it would reintroduce exactly the
   column problem — it would need splitting in two to be genuinely structural. It would also
   repoint the query functions the webhook and the retry worker use. A view keeps the money path
   untouched and still makes the read surface an allow-list.

2. **The view runs with owner rights (no `security_invoker`).** With `profiles` self-only, an invoker
   view would return nothing to anyone but the owner. Owner rights are what let it project rows the
   base RLS hides, and that is precisely why its select list must be treated as the security
   boundary. Documented at the top of the migration and asserted by a test.

3. **Reads and writes get different mechanisms, on purpose.** Reads are closed by removing the policy
   (structural, nothing to maintain). Writes are closed by column grants plus moving the system
   writers to `supabaseAdmin` — because the same table legitimately takes user writes on other
   columns. The runtime key filter in `updateProfile` is the third layer, and the one that holds even
   if a future migration relaxes a grant.

4. **Six columns dropped, not protected.** Zero readers, zero writers, no UI, and four are absent
   from the TypeScript types. `payout_method` / `payout_details_json` hold bank details per their own
   migration comment; their dictionary UI has been orphaned since the `payment_accounts` design was
   removed in T-219. Data that does not exist cannot leak.

5. **`seed.sql` reproduces the posture.** Its blanket `grant … on all tables` runs after migrations,
   so without repeating the revokes and column grants the fix would not exist locally, and the tests
   would assert a posture no deployed environment has. Same trap T-227 documented.

## Risks / Trade-offs

- [The view bypasses RLS by design; a column added to its select list is instantly public] → its
  select list is asserted against a declared constant by the inventory test, the same mechanism that
  keeps the migration, the seed and the tests in step.
- [Moving four call sites to `supabaseAdmin` widens service-role usage] → each writes the caller's
  OWN row with a value derived from Stripe, never from user input — the same thing the webhook and
  the retry worker already do with the same helper.
- [A column grant list must be maintained for writes] → mitigated by the runtime filter and by the
  inventory test asserting the writable set; and unlike the read side there is no way around it,
  since the table legitimately takes user writes.
- [Dropping columns is irreversible] → all six are provably empty (no writer anywhere, and
  `payout_details_json` only ever held its `'{}'` default); rollback of the code needs no
  down-migration, and restoring a column would be a new migration, which is the right friction.

## Migration Plan

One additive, idempotent migration. Rollback = revert the code; the dropped columns and the removed
policy would each need a deliberate new migration to come back.

## Open Questions

None — the shape (view vs private table) and the drop list were settled with the user before planning.
