-- Add 'rejected' as a valid upload_status. Used by the Inngest face-index
-- worker when post-upload byte validation (magic-byte / size-cap) fails:
-- the file is removed from Storage and the photos row is flipped to
-- 'rejected' so dashboards can surface it without scanning all photos.
alter table public.photos drop constraint if exists photos_upload_status_check;
alter table public.photos add constraint photos_upload_status_check
  check (upload_status in ('approved', 'pending', 'rejected'));

-- Targeted partial index — lets the "did the worker reject anything from
-- this batch?" lookup on the event detail page run as an index seek instead
-- of a full table scan once we accumulate volume.
create index if not exists photos_upload_status_rejected_idx
  on public.photos (upload_status)
  where upload_status = 'rejected';
