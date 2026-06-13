-- Create talent_saved_events table for talents to bookmark ("save") events.
-- Saved events are marked for easy return — they are NOT owned or joined.
-- Mirrors the talent_photo_tags bookmark pattern at the event level.

create table if not exists public.talent_saved_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  saved_at timestamptz not null default timezone('utc', now()),
  -- Updated whenever the talent revisits the saved event. Populated from the
  -- start to support a future "new photos since last visit" feature without a
  -- later migration. No UI surfaces it yet.
  last_seen_at timestamptz,

  -- A talent can't save the same event twice.
  unique(user_id, event_id)
);

-- Fast lookup of a talent's saved events.
create index if not exists talent_saved_events_user_id_idx
  on public.talent_saved_events(user_id);
create index if not exists talent_saved_events_event_id_idx
  on public.talent_saved_events(event_id);

-- RLS: a talent can only read/insert/update/delete their own rows.
alter table public.talent_saved_events enable row level security;

create policy "Talent can view their own saved events"
  on public.talent_saved_events
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Talent can save events"
  on public.talent_saved_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Needed so markEventSeen can update last_seen_at via the user-scoped client.
create policy "Talent can update their own saved events"
  on public.talent_saved_events
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Talent can unsave events"
  on public.talent_saved_events
  for delete
  to authenticated
  using (user_id = auth.uid());
