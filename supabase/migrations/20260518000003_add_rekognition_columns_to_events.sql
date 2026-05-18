-- Per-event AI-matching configuration + state. Used by:
--   - PR 2's Inngest worker (creates the Collection, indexes photos)
--   - PR 3's UI (toggle, status indicator, "Re-index event" button)
--   - PR 3's talent search (filters by ai_matching_status='ready')
--
-- This PR (1) only adds the columns. No code reads or writes them yet.

alter table public.events
  add column if not exists ai_matching_enabled       boolean not null default false,
  add column if not exists contains_minors           boolean not null default false,
  add column if not exists rekognition_collection_id text,
  add column if not exists rekognition_region        text,
  add column if not exists ai_matching_status        text not null default 'idle';

-- CHECK as a separate statement because `add column if not exists` cannot
-- carry an inline check constraint on every Postgres version we support.
-- Drop-then-add keeps reruns idempotent.
alter table public.events drop constraint if exists events_ai_matching_status_check;
alter table public.events add constraint events_ai_matching_status_check
  check (ai_matching_status in ('idle', 'indexing', 'ready', 'failed'));

comment on column public.events.ai_matching_enabled is
  'Photographer opt-in for face indexing on this event.';
comment on column public.events.contains_minors is
  'Compliance flag. Logically immutable after event creation — enforcement lives in the Server Action / form layer (PR 3), not the DB. When true, no faces are indexed regardless of ai_matching_enabled.';
comment on column public.events.rekognition_collection_id is
  'Per-event AWS Collection id. Nullable until PR 2 calls CreateCollection.';
comment on column public.events.rekognition_region is
  'AWS region where this event''s Collection lives. Nullable; defaults to eu-west-1 in PR 2. Stored per-event to support future multi-region routing.';
comment on column public.events.ai_matching_status is
  'Event-level indexing state: idle | indexing | ready | failed. Per-photo state lives on photos.face_index_status.';
