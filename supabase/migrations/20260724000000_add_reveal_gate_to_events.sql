-- Per-event "reveal photos only through search" gate (T-177). When enabled,
-- the event stays publicly discoverable but its photos are NOT browsable — they
-- are revealed only to a visitor who proves a face-search match. Enforcement is
-- server-side and fail-closed at the listing paths (the photo IDs/URLs are
-- withheld). This migration only adds the column; defaults OFF so shipping it
-- changes no behavior. Precondition (enforced in the app, not the DB): requires
-- ai_matching_enabled = true, and is unavailable on contains_minors events.
alter table public.events
  add column if not exists reveal_gate_enabled boolean not null default false;

comment on column public.events.reveal_gate_enabled is
  'T-177: when true, this event''s photos are hidden from browsing and revealed only via face search. Requires ai_matching_enabled; unavailable on contains_minors events.';
