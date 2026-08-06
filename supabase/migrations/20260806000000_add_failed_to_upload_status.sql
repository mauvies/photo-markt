-- T-231: add 'failed' as a valid upload_status.
--
-- Distinct from 'rejected'. 'rejected' means the bytes were BAD — the worker's
-- magic-byte/size validation refused them and DELETED the storage object, so
-- there is nothing to recover. 'failed' means the pipeline never reached a
-- verdict: the run exhausted its retries before `promote-upload-status` (a
-- Storage download that never resolved, an AWS IndexFaces that kept throwing).
-- The bytes are still in Storage and the photo is recoverable — the owner can
-- retry it from the event dashboard.
--
-- Before this, such a photo stayed 'pending' forever: invisible on the
-- approved-only galleries, absent from the moderation queue (which excludes
-- owner uploads), and re-driven by the reconcile cron every 30 min with no
-- possible outcome. 'failed' is the terminal state that stops all three.
alter table public.photos drop constraint if exists photos_upload_status_check;
alter table public.photos add constraint photos_upload_status_check
  check (upload_status in ('approved', 'pending', 'rejected', 'failed'));

-- Partial index on (event_id) — the owner's event page counts this event's
-- failed uploads on every render to decide whether to show the retry notice.
create index if not exists photos_upload_status_failed_idx
  on public.photos (event_id)
  where upload_status = 'failed';
