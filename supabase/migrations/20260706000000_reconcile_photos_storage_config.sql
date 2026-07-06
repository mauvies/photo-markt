-- Reconcile the `photos` storage configuration across every environment.
--
-- Bug (T-070): uploading an event cover as `.webp` failed with
-- "mime type image/webp is not supported". Root cause was **environment
-- drift** that no migration captured:
--
--   * The `photos` bucket in some environments carried a restrictive
--     `allowed_mime_types` list (jpeg/png/heic/heif, no webp). Supabase
--     Storage enforces `allowed_mime_types` even for the service-role client,
--     so the cover upload (which uses `supabaseAdmin`) was rejected. App-side
--     validation (`src/lib/photo-upload.ts`, magic bytes) already accepts
--     webp/avif/gif, so app and storage disagreed.
--   * `storage.objects` accumulated a divergent, duplicated policy set: a
--     stale MIME/size-restrictive INSERT policy plus five duplicate
--     `photos_*` / legacy policies, none of which exist on production. A fresh
--     `db reset` (via `remote_schema.sql`) recreated the mess, so local/CI and
--     staging never matched production.
--
-- Production is the source of truth: its `photos` bucket has no MIME/size
-- limit (validation is app-side by design — see
-- `20260702000000_create_photos_bucket.sql`) and only two owner-scoped
-- storage.objects policies (delete + update). Uploads go through signed URLs
-- (which bypass RLS) and the service-role client, so no INSERT/SELECT policy
-- is required for the bucket to work.
--
-- This migration codifies that canonical state so prod, staging, and
-- local/CI are provisioned identically and a MIME restriction can never
-- silently come back and reject webp again. Idempotent and safe to re-run.

-- 1. Bucket: no MIME allow-list, no size cap. Enforcement lives app-side
--    (magic bytes + 50 MB cap). This is a no-op where already null; it
--    guarantees the invariant regardless of prior manual edits.
update storage.buckets
set allowed_mime_types = null,
    file_size_limit = null
where id = 'photos';

-- 2. Converge storage.objects policies to production's exact set. Drop the
--    divergent policies present in staging/local but not prod:
--      - the stale MIME/size-restrictive INSERT policy (the T-070 footgun)
--      - duplicate/legacy per-command policies
--    Uses `drop policy if exists`, so it's a no-op on production (where these
--    were already removed) and idempotent everywhere else. The two kept
--    policies ("Allow users to delete/update their own objects 1io9m69_0")
--    remain untouched.
drop policy if exists "Allow users to upload only into userId/... 1io9m69_0" on storage.objects;
drop policy if exists "allow users to list/view their own objects 1io9m69_0" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
