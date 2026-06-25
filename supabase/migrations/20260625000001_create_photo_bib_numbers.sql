-- One row per distinct bib number detected on a photo by AWS Rekognition
-- DetectText. Mirrors photo_faces (20260518000002): writes happen exclusively
-- through the service-role client in the Inngest detection worker; reads are
-- gated by RLS to the photo's event owner or anyone on a public, non-deleted
-- event. DetectText is stateless, so — unlike faces — there is no AWS
-- collection to reference here.

create table if not exists public.photo_bib_numbers (
  id           uuid primary key default gen_random_uuid(),
  photo_id     uuid not null references public.photos(id) on delete cascade,
  bib_text     text not null,
  confidence   numeric not null,
  bounding_box jsonb,
  detected_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (photo_id, bib_text)
);

create index if not exists photo_bib_numbers_photo_id_idx
  on public.photo_bib_numbers (photo_id);
-- Talent search is a point-lookup by bib_text scoped to an event; this index
-- keeps it off a full-table scan as the table grows.
create index if not exists photo_bib_numbers_bib_text_idx
  on public.photo_bib_numbers (bib_text);

alter table public.photo_bib_numbers enable row level security;

-- SELECT: (a) the photographer who owns the underlying photo's event, or
-- (b) anyone for photos belonging to a public, non-deleted event.
-- INSERT/UPDATE/DELETE: no policies — writes happen exclusively through the
-- service-role client in the Inngest worker, mirroring photo_faces.
drop policy if exists "Owners and public-event viewers can read photo_bib_numbers"
  on public.photo_bib_numbers;
create policy "Owners and public-event viewers can read photo_bib_numbers"
  on public.photo_bib_numbers
  for select
  using (
    exists (
      select 1
      from public.photos p
      join public.events e on e.id = p.event_id
      where p.id = photo_bib_numbers.photo_id
        and e.deleted_at is null
        and (e.user_id = auth.uid() or e.is_public = true)
    )
  );

comment on table public.photo_bib_numbers is
  'Race bib numbers detected per photo via AWS Rekognition DetectText. Writes via service-role only (Inngest worker).';
comment on column public.photo_bib_numbers.bib_text is
  'A plausible bib token kept after filtering DetectText output (digit-dominant, confidence-thresholded, deduped). Search target for talent gallery bib search.';
comment on column public.photo_bib_numbers.confidence is
  'DetectText confidence (0-100) for this token.';
