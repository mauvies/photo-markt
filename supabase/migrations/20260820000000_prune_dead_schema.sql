-- T-219 · Prune the dead schema.
--
-- An archaeological layer that every audit re-discovered and nobody removed.
-- It was not inert:
--
--   * `payment_accounts` stored photographer bank/PayPal details in a jsonb
--     column with ZERO readers in the app. Superseded by Stripe Connect
--     (`profiles.stripe_connect_account_id`) since 20260501000000 — so it was
--     a standing privacy liability with no product behind it. `payouts`
--     identifies its destination through the photographer's Connect account;
--     `payment_account_id` has had no writer since `createPayout` was deleted
--     in T-220.
--   * `profiles.is_admin` is the dangerous one. Real platform authorization is
--     `admin_users` (moved there by 20260513000000 because `profiles` has a
--     public SELECT policy that leaked the admin list). A column *named* like a
--     gate that gates nothing is how the next bypass gets written in good faith.
--     The drop is belt-and-braces; the standing guard is
--     `test/unit/database/dead-schema-pruned.test.ts`.
--   * `ai_search_profiles` is the last remnant of the abandoned CLIP/pgvector
--     matching path (its `selfie_embedding` went in 20260518000000). Face
--     matching is AWS Rekognition now: selfies are sent per search and never
--     stored, and the per-event gating flags live on `events`.
--   * `ai_search_usage` was a half-built per-plan monthly search quota, already
--     dropped by 20260622000000 — repeated here because the migration set is
--     known not to describe production completely.
--   * `time_sync_tokens`, `upload_batches`, `upload_objects` and the
--     `events.{start_date,end_date,time_offset,time_sync_enabled}` columns are
--     the camera-time-sync and batch-upload features that were never finished.
--     Zero references in `src/`, still carrying anon/authenticated DML grants
--     from the pre-RLS era.
--   * `events.organizer_fee_per_photo_cents` was WRITTEN by the create wizard
--     and read by no money path. The field's own copy promised organizers it
--     was "charged on top of the platform fee whenever a contributor's photo
--     sells", which was never true. The wizard field goes with the column;
--     building the real organizer revenue split is a separate feature.
--   * `set_photo_embeddings_updated_at` outlived its table (`drop table
--     ... cascade` removes the trigger, not the function it called).
--   * `search_user_by_email(text)` has zero callers — `search_users_by_text`
--     (bounded by 20260804000000) is the live one, and resolving PII from ids
--     already known server-side (`get_user_emails_batch`) is the preferred
--     shape over exposing email to a lookup at all.
--
-- EVERY STATEMENT IS `if exists`. Two of these artifacts already have drop
-- migrations, and a migration edited after being applied never re-runs, so
-- environments legitimately disagree about what is present. The migration must
-- apply cleanly against a database in either state, and against itself twice.
--
-- ROLLBACK IS INERT: no live read or write path touches anything below, so
-- reverting the accompanying code needs no down-migration.

-- ── Tables ───────────────────────────────────────────────────────────────────
drop table if exists public.payment_accounts cascade;
drop table if exists public.ai_search_profiles cascade;
drop table if exists public.ai_search_usage cascade;
drop table if exists public.time_sync_tokens cascade;
drop table if exists public.upload_objects cascade;
drop table if exists public.upload_batches cascade;

-- ── Columns ──────────────────────────────────────────────────────────────────
-- The FK went with `payment_accounts` above; the column and its index did not.
drop index if exists public.payouts_payment_account_id_idx;
alter table public.payouts drop column if exists payment_account_id;

alter table public.events drop column if exists start_date;
alter table public.events drop column if exists end_date;
alter table public.events drop column if exists time_offset;
alter table public.events drop column if exists time_sync_enabled;
alter table public.events drop column if exists organizer_fee_per_photo_cents;

alter table public.profiles drop column if exists is_admin;

-- ── Functions ────────────────────────────────────────────────────────────────
drop function if exists public.set_payment_accounts_updated_at() cascade;
drop function if exists public.set_ai_search_profiles_updated_at() cascade;
drop function if exists public.set_photo_embeddings_updated_at() cascade;
drop function if exists public.search_user_by_email(text);

-- ── pgvector leftovers ───────────────────────────────────────────────────────
-- `drop extension` fails while ANY object still depends on the `vector` type,
-- so its known dependents are cleared first — the same defensive treatment
-- `ai_search_usage` gets above, and for the same reason: 20260518000000 already
-- dropped these, but the migration set is not a complete description of
-- production, and the ARCHITECTURE.md text this change deletes said the
-- `photo_embeddings` table "may still physically exist".
drop table if exists public.photo_embeddings cascade;

-- The two `search_photos_by_similarity` overloads take `vector` in their
-- SIGNATURE, which is what makes them a dependency. ⚠️ Guarded on the extension
-- existing: naming a type in a `drop function` statement fails when that type is
-- gone, so an unguarded drop would break this migration on exactly the
-- already-pruned database the `if exists` guards exist to tolerate.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'drop function if exists public.search_photos_by_similarity('
      || 'vector, double precision, integer, text, text, text, date, date)';
    execute 'drop function if exists public.search_photos_by_similarity('
      || 'vector, double precision, integer, text, text, text, timestamptz, timestamptz)';
  end if;
end $$;

-- Deliberately WITHOUT `cascade`: a surviving dependent should stop this
-- statement, not be destroyed by it.
--
-- ⚠️ It does NOT stop the migration. `.github/workflows/migrate.yml` runs
-- `psql -f` with no `ON_ERROR_STOP` and records the version on the next line
-- regardless, so a failure here prints an ERROR into a green job and the
-- migration is marked applied — and an applied migration never re-runs. Every
-- statement above it has already committed (autocommit, no transaction), so the
-- worst case is benign and visible in the schema: everything else pruned, the
-- `vector` extension still installed, to be removed by a follow-up migration.
-- That is why the dependents above are cleared rather than trusted to be gone.
drop extension if exists vector;
