-- Track storage size per photo so the photographer dashboard can compute
-- real "used" bytes instead of estimating photos × 5 MB.

alter table public.photos
  add column if not exists size_bytes bigint;

create index if not exists photos_user_size_idx
  on public.photos (user_id)
  include (size_bytes);

-- Backfill from storage.objects metadata for already-uploaded photos.
-- storage.objects.metadata is jsonb and stores 'size' (bytes) at upload time.
update public.photos p
set size_bytes = ((o.metadata ->> 'size')::bigint)
from storage.objects o
where o.bucket_id = 'photos'
  and o.name = p.original_url
  and p.size_bytes is null;
