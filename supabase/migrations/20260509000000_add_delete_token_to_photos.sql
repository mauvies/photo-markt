-- Random per-photo token returned to guest uploaders so they can delete
-- their own contributions. Authenticated uploaders are verified via
-- photos.uploaded_by; this column is null for owner uploads.

ALTER TABLE public.photos ADD COLUMN delete_token text;
