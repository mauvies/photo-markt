-- One-time cleanup of photos rows with `event_id IS NULL`.
--
-- Root cause: `photos_event_id_fkey` was created with `ON DELETE SET NULL`,
-- so any historical hard-delete of an event left its photos orphaned
-- (event_id = NULL). Production data shows ~40 such rows from November
-- 2025, almost certainly from a pre-refactor `deleteEvent` that physically
-- removed events instead of soft-deleting via `deleted_at`. Current
-- `deleteEvent` is soft-only, so the bug is closed at the application
-- layer — but the DB still has the historical fallout.
--
-- This migration is in 3 stages, all inside the implicit transaction Supabase
-- wraps around the file:
--   1. Capture each orphan's `original_url` into a queue table that an
--      Inngest worker drains separately. We can't DELETE FROM Supabase
--      Storage inside SQL, so the storage objects need a separate pass.
--   2. Delete the orphan photo rows. cart_items / photo_faces /
--      talent_photo_tags cascade automatically (CASCADE on photo_id).
--      Orphans referenced by order_items / guest_order_items (RESTRICT)
--      are intentionally skipped — those reflect real purchases and need
--      manual review.
--   3. Re-run is a no-op: the cutoff `created_at < 2026-01-01` plus
--      `event_id IS NULL` matches nothing after stage 2.
--
-- The companion migration `20260520000001_photos_event_id_cascade.sql`
-- flips the FK to `ON DELETE CASCADE` so future hard-deletes can't
-- recreate this class of orphan.

-- Queue table for the storage-side cleanup. Service-role-only access
-- (RLS enabled, zero policies) — the Inngest worker that drains it uses
-- `supabaseAdmin`. Lives in `public` for visibility from Studio.
create table if not exists public.photos_orphan_storage_pending_cleanup (
  id uuid primary key default gen_random_uuid(),
  original_url text not null unique,
  enqueued_at timestamptz not null default now()
);

alter table public.photos_orphan_storage_pending_cleanup enable row level security;
comment on table public.photos_orphan_storage_pending_cleanup is
  'One-shot queue feeding `cleanup-orphaned-storage-from-migration` Inngest worker. Each row is a Supabase Storage path that lost its `photos` row in the orphan-cleanup migration. Service-role only.';

do $$
declare
  enqueued_count int;
  deleted_count int;
  skipped_with_orders_count int;
begin
  -- 1. Capture original_urls for the storage cleanup pass.
  insert into public.photos_orphan_storage_pending_cleanup (original_url)
  select distinct p.original_url
  from public.photos p
  where p.event_id is null
    and p.created_at < timestamp '2026-01-01'
    and p.original_url is not null
    and not exists (select 1 from public.order_items oi where oi.photo_id = p.id)
    and not exists (select 1 from public.guest_order_items goi where goi.photo_id = p.id)
  on conflict (original_url) do nothing;

  get diagnostics enqueued_count = row_count;

  -- 2. Count orphans we're about to skip (orders referenced) for audit log.
  select count(*) into skipped_with_orders_count
  from public.photos p
  where p.event_id is null
    and p.created_at < timestamp '2026-01-01'
    and (
      exists (select 1 from public.order_items oi where oi.photo_id = p.id)
      or exists (select 1 from public.guest_order_items goi where goi.photo_id = p.id)
    );

  -- 3. Delete the orphan rows. Cascades through cart_items, photo_faces,
  --    talent_photo_tags (all CASCADE on photo_id). Order-referenced rows
  --    are excluded via NOT EXISTS — those need manual review.
  with deleted as (
    delete from public.photos p
    where p.event_id is null
      and p.created_at < timestamp '2026-01-01'
      and not exists (select 1 from public.order_items oi where oi.photo_id = p.id)
      and not exists (select 1 from public.guest_order_items goi where goi.photo_id = p.id)
    returning 1
  )
  select count(*) into deleted_count from deleted;

  raise notice '[cleanup_orphaned_photos] deleted=% storage_paths_enqueued=% skipped_with_orders=%',
    deleted_count, enqueued_count, skipped_with_orders_count;
end$$;
