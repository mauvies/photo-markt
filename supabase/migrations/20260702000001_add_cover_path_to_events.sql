-- Dedicated event cover/presentation image (T-055).
--
-- Photographers can upload one dedicated cover image per event (separate from
-- the for-sale photos). It is stored in the private `photos` bucket at
-- `${ownerId}/${eventId}/cover-<uuid>.<ext>` and its path is recorded here.
--
-- Nullable: when null, event cards fall back to the first photo (the previous
-- behavior), so existing events are unaffected and rollback is inert.
alter table events add column if not exists cover_path text;
