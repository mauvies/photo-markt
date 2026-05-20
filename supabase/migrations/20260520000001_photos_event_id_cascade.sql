-- Flip `photos.event_id` FK from `ON DELETE SET NULL` to `ON DELETE CASCADE`.
--
-- Why: the old `SET NULL` behavior was the root cause of the orphan-photos
-- class fixed in the previous migration. When an event was hard-deleted,
-- every photo it contained had `event_id` silently nulled, leaking from
-- the gallery while still inflating the photographer's storage counter.
--
-- The current application layer only soft-deletes events (`deleted_at`
-- timestamp), so this FK is mostly defensive — but it ALSO has to change
-- before we can add `NOT NULL` to `event_id` in the next migration: a
-- `SET NULL` FK on a `NOT NULL` column would fail every event delete.
--
-- CASCADE is the right semantic: if an event is physically removed
-- (future GDPR right-to-erasure, ops cleanup, etc.), its photos go with
-- it. The order_items / guest_order_items RESTRICT chains still protect
-- sold photos from accidental hard-delete via this path.

alter table public.photos drop constraint if exists photos_event_id_fkey;

alter table public.photos add constraint photos_event_id_fkey
  foreign key (event_id) references public.events(id) on delete cascade;
