-- Rollback of the per-event photo code feature (change `photo-event-code`,
-- ticket T-011). The feature was reverted — its application code is gone, so
-- this drops everything the previous migration added. Every statement is
-- `if exists`, so it is safe whether or not the add migration was applied to a
-- given environment (e.g. if it never reached the cloud DB, this is a no-op).

drop trigger if exists photos_set_sequence on public.photos;
drop function if exists public.set_photo_sequence();
drop index if exists public.photos_event_sequence_idx;
alter table public.photos drop column if exists sequence;
alter table public.photos drop column if exists label;
alter table public.events drop column if exists photo_sequence_counter;
