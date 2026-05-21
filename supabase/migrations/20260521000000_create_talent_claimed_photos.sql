-- talent_claimed_photos: free event photos a talent has claimed into their
-- profile / owned-photos collection. Distinct from `talent_photo_tags`
-- (favorites/bookmarks) — a claimed photo is "owned", surfaced alongside
-- purchased photos on /dashboard/talent/profile.

create table if not exists public.talent_claimed_photos (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  talent_user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default timezone('utc', now()),

  -- A photo can only be claimed once per talent.
  unique(photo_id, talent_user_id)
);

create index if not exists talent_claimed_photos_talent_user_id_idx
  on public.talent_claimed_photos(talent_user_id);
create index if not exists talent_claimed_photos_photo_id_idx
  on public.talent_claimed_photos(photo_id);

alter table public.talent_claimed_photos enable row level security;

-- A talent reads only their own claims.
create policy "Talent can view their own claimed photos"
  on public.talent_claimed_photos
  for select
  to authenticated
  using (talent_user_id = auth.uid());

-- A talent can only claim photos for themselves. The free-event business
-- rule (the photo's event must have no price) is enforced server-side in the
-- `addPhotoToProfileAction` Server Action — RLS cannot cheaply join to the
-- event price here.
create policy "Talent can claim photos for themselves"
  on public.talent_claimed_photos
  for insert
  to authenticated
  with check (talent_user_id = auth.uid());

-- No UPDATE or DELETE policy: claiming is add-only. An owned photo stays
-- owned, like a purchased one.
