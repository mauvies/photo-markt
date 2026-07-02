-- Provision the `photos` storage bucket via migration.
--
-- Root cause of a production incident: buckets were historically created by
-- hand in Supabase Studio (see the note in
-- test/helpers/supabase-test-client.ts). That manual step was missed in
-- production — the `photos` bucket never existed there. Every
-- `createSignedUploadUrl('photos', …)` inserts a row into storage.objects with
-- bucket_id = 'photos', which violated the objects_bucketId_fkey foreign key
-- (bucket_id -> storage.buckets) and failed with Postgres error 23503,
-- surfaced by storage-api as "The related resource does not exist". As a
-- result photo upload never worked in production (storage.objects was empty).
--
-- Codifying the bucket as a migration guarantees every environment (prod,
-- staging, fresh local/CI) provisions it identically, so this can't recur.
--
-- Config mirrors staging and the test helper (`createBucket('photos',
-- { public: false })`): private bucket, no bucket-level size/MIME limits —
-- upload validation is enforced app-side by src/lib/photo-upload.ts (magic
-- bytes, 50 MB cap) and the Inngest worker. Idempotent so re-runs and the
-- already-created prod/staging buckets are left untouched.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;
