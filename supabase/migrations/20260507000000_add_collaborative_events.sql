-- Collaborative events: allow multiple users (including unauthenticated guests)
-- to upload photos to a shared private event, with optional owner moderation.

ALTER TABLE public.events
  ADD COLUMN is_collaborative boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_guest_upload boolean NOT NULL DEFAULT true,
  ADD COLUMN require_upload_approval boolean NOT NULL DEFAULT false;

ALTER TABLE public.photos
  ADD COLUMN uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN guest_name text,
  ADD COLUMN upload_status text NOT NULL DEFAULT 'approved'
    CHECK (upload_status IN ('approved', 'pending'));

CREATE INDEX photos_event_upload_status_idx
  ON public.photos (event_id, upload_status)
  WHERE upload_status <> 'approved';

-- Guest uploads run through a Server Action with the service-role client and
-- inherit the event owner's user_id, so existing photos and storage RLS apply
-- unchanged. Storage path for guest contributions:
--   collaborative/{event_id}/{file_uuid}.{ext}
