-- Enforce that every new `photos` row carries an `event_id`, closing the
-- orphan class fixed in `20260520000000_cleanup_orphaned_photos.sql`.
--
-- Why a `CHECK (...) NOT VALID` constraint instead of `SET NOT NULL`:
-- production still holds a few legacy orphan rows the cleanup migration
-- deliberately did NOT delete — orphans referenced by `order_items` /
-- `guest_order_items`, i.e. real purchases protected by the RESTRICT FK
-- chain. `ALTER COLUMN ... SET NOT NULL` scans every existing row and
-- aborts if any is NULL, so it can never succeed while that purchase
-- history exists (it failed in exactly this way on the first deploy).
--
-- `CHECK (event_id IS NOT NULL) NOT VALID`:
--   - IS enforced for every INSERT and UPDATE from now on — no new orphan
--     can be created, which is the defense-in-depth goal;
--   - does NOT re-scan existing rows, so the legacy sold-orphan rows are
--     left intact and this migration applies cleanly.
--
-- The constraint stays `NOT VALID` permanently. VALIDATE would require
-- zero NULL rows, and the survivors are intentional purchase history we
-- will not delete. New-row enforcement does not depend on validation.
--
-- Sequencing: runs after the cleanup (00) and the FK cascade flip (01).
-- The cascade flip is still required — with this CHECK in place, a
-- `SET NULL` FK would make every event delete violate the constraint.

alter table public.photos drop constraint if exists photos_event_id_not_null;

alter table public.photos
  add constraint photos_event_id_not_null check (event_id is not null) not valid;
