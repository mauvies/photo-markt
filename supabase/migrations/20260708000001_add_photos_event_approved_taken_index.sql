-- Index the hottest read in the app: the gallery page query (public + owner
-- approved view) is
--   event_id = X AND upload_status = 'approved' ORDER BY taken_at, id  + .range()
-- (see getEventPhotosPublicPage / getEventPhotosPage in database/queries/photos.ts).
--
-- Before this index the only composite touching upload_status is partial
-- `WHERE upload_status <> 'approved'` (photos_event_upload_status_idx) — it
-- EXCLUDES exactly the rows this query reads. Postgres fell back to the plain
-- (event_id) index plus an in-memory sort on every page, so large events
-- re-sorted the whole approved set per page. This partial index matches the
-- filter and the sort key, so paging is an ordered index range scan with no
-- sort step.
--
-- Non-CONCURRENTLY on purpose: a plain CREATE INDEX takes a SHARE lock that
-- blocks writes to photos for the build duration, but the prod photos table is
-- ~300 rows / 128 kB today, so the build (and the lock) is sub-millisecond —
-- adding it now, while the table is tiny, is the cheapest possible moment.
-- CONCURRENTLY is also not an option here: migrate.yml runs each migration
-- inside a transaction and CREATE INDEX CONCURRENTLY cannot run in one (it
-- would need a no-transaction migration and risks leaving an INVALID index on
-- failure). If a future index is ever added to a then-large photos table, that
-- migration should use CONCURRENTLY in a dedicated no-transaction file.
create index if not exists photos_event_approved_taken_idx
  on public.photos (event_id, taken_at, id)
  where upload_status = 'approved';

-- NOTE (T-087): the ticket also asked to drop a supposed duplicate
-- `photos_event_idx` ≡ `photos_event_id_idx`. That duplicate does NOT exist.
-- Migration 20260427162800_remote_schema.sql already dropped the old
-- `photos_event_id_idx` (line 281) and recreated the plain (event_id) index
-- under the canonical name `photos_event_idx` (line 426) — a routine
-- `supabase db pull` rename artifact. Both production and local confirm only
-- `photos_event_idx` remains. It is NOT redundant with the new partial index:
-- it is the sole (event_id) index and still serves all-status event_id lookups
-- (e.g. getPhotoStoragePaths on delete, getUploadedPhotoIdsForUserInEvent for
-- collaborative-upload dedup) that the two partial indexes can't cover. So it
-- is intentionally kept — nothing to drop here.
