-- Per-photo face-indexing state. Populated by PR 2's Inngest worker.
-- 'pending' is the default for every existing row so the worker treats the
-- whole table as a backfill queue when AI matching ships.

alter table public.photos
  add column if not exists face_index_status text not null default 'pending';

alter table public.photos drop constraint if exists photos_face_index_status_check;
alter table public.photos add constraint photos_face_index_status_check
  check (
    face_index_status in (
      'pending',         -- photo uploaded, awaiting indexing.
      'indexing',        -- worker currently processing.
      'indexed',         -- success — photo_faces rows exist.
      'failed',          -- transient/AWS error; eligible for re-index.
      'no_faces',        -- AWS processed but detected no faces. Terminal, not an error.
      'not_applicable'   -- photo's event has AI matching disabled. Terminal.
    )
  );

-- Background workers scan for 'pending' / 'failed' rows; this index keeps
-- that scan off a full-table seq scan as the photos table grows.
create index if not exists photos_face_index_status_idx
  on public.photos (face_index_status);

comment on column public.photos.face_index_status is
  'Per-photo face-indexing state. See check constraint for status semantics.';
