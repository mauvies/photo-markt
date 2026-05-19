-- One-time recovery for photos stuck after the prior worker step-output-size
-- bug. Two surgical updates, both safe to re-run (idempotent):
--
-- (a) Reset face_index_status='failed' → 'pending' so the next backfill
--     (manual "Re-index event" or the `event.ai-matching-enabled` worker)
--     re-enqueues them. The new worker no longer trips the 4 MB step-output
--     ceiling, so re-processing should succeed.
--
-- (b) Promote owner-uploaded photos that got stuck at upload_status='pending'
--     because the prior worker crashed at the step-output boundary BEFORE
--     reaching its promote-upload-status step. Owner uploads are signalled by
--     `photos.user_id = events.user_id` AND `photos.guest_name IS NULL` —
--     the same predicate the new worker uses in its step-3 logic. These
--     photos already passed the direct-upload flow's pre-flight validation
--     (plan-limit + per-event cap); re-running the worker just to promote
--     them would be wasteful. Guest uploads on require_upload_approval=true
--     events are left alone — they correctly belong in the owner's approval
--     queue.
--
-- Net effect for the user: existing collaborative-event photos uploaded by
-- the owner become visible to talents via share code immediately on next
-- request (after the public-event cache TTL refreshes; the worker change in
-- this PR also invalidates that tag on promote).

update public.photos
   set face_index_status = 'pending'
 where face_index_status = 'failed';

update public.photos p
   set upload_status = 'approved'
  from public.events e
 where p.event_id = e.id
   and p.upload_status = 'pending'
   and p.guest_name is null
   and p.user_id = e.user_id;
