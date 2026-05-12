-- Local-reset compatibility shim.
--
-- The schema dump in `20260427162800_remote_schema.sql` drops the function
-- `public.sync_profile_avatar_url()` (created in `20260427000000_photographer_profiles.sql`)
-- but does NOT first drop the dependent trigger `trg_sync_profile_avatar_url`
-- on `auth.users`. That works on staging because the trigger was already
-- dropped manually before the dump was generated. On a fresh `supabase db
-- reset` against the migrations in this repo, the function-drop fails with
-- SQLSTATE 2BP01 ("cannot drop function because other objects depend on it").
--
-- Drop the trigger explicitly here so the subsequent migration succeeds. This
-- is a no-op on staging / prod where the trigger is already absent.

drop trigger if exists trg_sync_profile_avatar_url on auth.users;
