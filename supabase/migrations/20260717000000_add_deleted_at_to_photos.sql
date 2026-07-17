-- Soft-delete for photos (T-142 / purchased-photo-retention).
--
-- A photo that has been SOLD (it appears in a completed order_items /
-- guest_order_items row) must never be hard-deleted — the buyer paid and keeps
-- permanent access. When a photographer deletes such a photo (individually,
-- in bulk, as a contributor, or by deleting the whole event), the app stamps
-- `deleted_at` instead of removing the row, keeping the row AND its storage
-- object while hiding it from every photographer / public / gallery / search /
-- cart / cover surface. Buyer-facing reads (purchased library, orders,
-- downloads) and the orphaned-storage-cleanup in-use set deliberately keep
-- reading soft-deleted rows. The ON DELETE RESTRICT foreign keys on
-- order_items.photo_id / guest_order_items.photo_id remain as a hard fail-safe
-- backstop; orders/order_items are never touched.
--
-- Additive + idempotent. No backfill (existing rows stay deleted_at = NULL).

alter table public.photos
  add column if not exists deleted_at timestamptz;

-- Recreate the hot gallery partial index (originally from
-- 20260708000001_add_photos_event_approved_taken_index.sql) so the paginated
-- gallery query — event_id = X AND upload_status = 'approved' ORDER BY taken_at,
-- id — stays an ordered index range scan now that it also carries
-- `deleted_at IS NULL`. Non-CONCURRENTLY on purpose: migrate.yml runs each
-- migration in a transaction (CREATE INDEX CONCURRENTLY can't) and the prod
-- photos table is tiny, so the SHARE lock is sub-millisecond.
drop index if exists photos_event_approved_taken_idx;
create index if not exists photos_event_approved_taken_idx
  on public.photos (event_id, taken_at, id)
  where upload_status = 'approved' and deleted_at is null;
