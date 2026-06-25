-- Per-photo bib-detection state. Nullable (unlike face_index_status, which
-- defaults 'pending'): bib detection is per-event opt-in, so most photos never
-- run it — NULL means "not applicable / not run" and avoids implying the whole
-- table is a backfill queue. The Inngest worker sets it only for opted-in
-- events.

alter table public.photos
  add column if not exists bib_detection_status text;

alter table public.photos drop constraint if exists photos_bib_detection_status_check;
alter table public.photos add constraint photos_bib_detection_status_check
  check (
    bib_detection_status is null
    or bib_detection_status in (
      'pending',         -- queued for detection (opted-in event).
      'detecting',       -- worker currently processing.
      'detected',        -- success — photo_bib_numbers rows may exist.
      'no_bibs',         -- DetectText ran but found no plausible bib. Terminal, not an error.
      'failed',          -- transient/AWS error; eligible for re-detection.
      'not_applicable'   -- event has bib detection disabled. Terminal.
    )
  );

create index if not exists photos_bib_detection_status_idx
  on public.photos (bib_detection_status);

comment on column public.photos.bib_detection_status is
  'Per-photo bib-detection state. NULL = not applicable / not run. See check constraint for status semantics.';
