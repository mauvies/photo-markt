-- Per-event photo "code": a stable auto-assigned sequence plus an optional
-- photographer-editable label. Photographer-only — used to identify/organize
-- photos in the event album. The displayed code is `label` when set, else the
-- sequence number. See change `photo-event-code` (ticket T-011).

alter table public.photos add column if not exists sequence integer;
alter table public.photos add column if not exists label text;

comment on column public.photos.sequence is
  'Auto-assigned, stable per-event sequence number (assigned by trigger on insert). Never reused; gaps allowed after deletes.';
comment on column public.photos.label is
  'Optional photographer-editable override for the photo code. NULL = fall back to the sequence number. Untrusted display-only text.';

-- Monotonic per-event counter. Stored on the event so numbers are NEVER reused
-- (even after the highest-numbered photo is deleted) and concurrent uploads to
-- the same event cannot collide — the trigger's UPDATE locks this event row.
alter table public.events add column if not exists photo_sequence_counter integer not null default 0;

-- Backfill: number each event''s existing photos by upload order, then set the
-- counter to that event''s current max so new inserts continue from there.
with ranked as (
  select id, row_number() over (partition by event_id order by created_at, id) as rn
  from public.photos
  where event_id is not null
)
update public.photos p
set sequence = ranked.rn
from ranked
where p.id = ranked.id
  and p.sequence is null;

update public.events e
set photo_sequence_counter = coalesce(
  (select max(sequence) from public.photos where event_id = e.id),
  0
);

-- Assign the next per-event sequence on insert when one wasn't supplied. Plain
-- (non-SECURITY DEFINER) trigger function: it runs as the inserting role, which
-- already holds insert/update rights on these rows — no privilege escalation.
-- The UPDATE ... RETURNING locks the event row, so the counter is atomic and
-- monotonic under concurrent inserts. Calling it outside a trigger errors (no
-- NEW), so it is inert if invoked directly.
create or replace function public.set_photo_sequence()
returns trigger
language plpgsql
as $$
begin
  if new.sequence is null and new.event_id is not null then
    update public.events
      set photo_sequence_counter = photo_sequence_counter + 1
      where id = new.event_id
      returning photo_sequence_counter into new.sequence;
  end if;
  return new;
end;
$$;

drop trigger if exists photos_set_sequence on public.photos;
create trigger photos_set_sequence
  before insert on public.photos
  for each row
  execute function public.set_photo_sequence();

create index if not exists photos_event_sequence_idx
  on public.photos (event_id, sequence);
