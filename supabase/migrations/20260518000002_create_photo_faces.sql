-- One row per face detected on a photo by AWS Rekognition IndexFaces.
-- We do NOT store the face embedding itself — AWS owns it inside the
-- Collection (one Collection per event; see events.rekognition_collection_id
-- in 20260518000003). We only persist the AWS-returned face_id so that
-- after a talent's SearchFacesByImage call we can map the returned face_ids
-- back to our photos via this table (point-lookup by aws_face_id).

create table if not exists public.photo_faces (
  id                uuid primary key default gen_random_uuid(),
  photo_id          uuid not null references public.photos(id) on delete cascade,
  aws_face_id       text not null,
  aws_collection_id text not null,
  confidence        numeric not null,
  bounding_box      jsonb,
  indexed_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (photo_id, aws_face_id)
);

create index if not exists photo_faces_photo_id_idx
  on public.photo_faces (photo_id);
create index if not exists photo_faces_aws_face_id_idx
  on public.photo_faces (aws_face_id);
create index if not exists photo_faces_aws_collection_id_idx
  on public.photo_faces (aws_collection_id);

alter table public.photo_faces enable row level security;

-- SELECT: (a) the photographer who owns the underlying photo's event, or
-- (b) anyone for photos belonging to a public, non-deleted event.
-- INSERT/UPDATE/DELETE: no policies — writes happen exclusively through the
-- service-role client in PR 2's Inngest worker, mirroring rate_limit_buckets.
drop policy if exists "Owners and public-event viewers can read photo_faces"
  on public.photo_faces;
create policy "Owners and public-event viewers can read photo_faces"
  on public.photo_faces
  for select
  using (
    exists (
      select 1
      from public.photos p
      join public.events e on e.id = p.event_id
      where p.id = photo_faces.photo_id
        and e.deleted_at is null
        and (e.user_id = auth.uid() or e.is_public = true)
    )
  );

comment on table public.photo_faces is
  'AWS Rekognition face records per photo. Writes via service-role only (Inngest worker in PR 2).';
comment on column public.photo_faces.aws_face_id is
  'The face_id returned by Rekognition IndexFaces. Point-lookup target after SearchFacesByImage maps back to our photos.';
comment on column public.photo_faces.aws_collection_id is
  'The per-event Rekognition collection id this face was indexed into. Denormalized so cleanup on event delete can target a single collection without joining events.';
