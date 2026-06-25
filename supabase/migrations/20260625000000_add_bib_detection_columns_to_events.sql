-- Per-event BIB (race bib number) detection opt-in + state. Mirrors the
-- Rekognition AI-matching columns (20260518000003). This migration only adds
-- the columns; no code reads or writes them yet. The opt-in defaults OFF so
-- shipping this incurs no AWS cost and changes no behavior.

alter table public.events
  add column if not exists bib_detection_enabled boolean not null default false,
  add column if not exists bib_detection_status  text not null default 'idle';

-- CHECK as a separate, drop-then-add statement (idempotent reruns), since
-- `add column if not exists` can't carry an inline check on every supported
-- Postgres version. Mirrors events_ai_matching_status_check.
alter table public.events drop constraint if exists events_bib_detection_status_check;
alter table public.events add constraint events_bib_detection_status_check
  check (bib_detection_status in ('idle', 'detecting', 'ready', 'failed'));

comment on column public.events.bib_detection_enabled is
  'Photographer opt-in for bib-number detection on this event. The per-event opt-in is the cost gate for the paid-per-image Rekognition DetectText call.';
comment on column public.events.bib_detection_status is
  'Event-level bib-detection state: idle | detecting | ready | failed. Per-photo state lives on photos.bib_detection_status.';
