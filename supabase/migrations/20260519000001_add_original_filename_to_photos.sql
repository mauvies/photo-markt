-- Track the user-supplied filename at upload time so that purchased-photo
-- downloads can suggest a sensible name ("athlete-finish-line.jpg" beats
-- "uuid-generated.jpg"). The column is intentionally **not backfilled** for
-- pre-existing rows — those continue to fall back to the generic filename
-- the existing download code already generates today. Adding a backfill
-- would be a one-off rewrite with no source of truth (we never persisted
-- the original name), and the value is purely cosmetic.
--
-- Untrusted user data. Treat as display-only; never use as a storage path
-- component, command argument, or file-system path. Storage paths are
-- always server-generated as `${userId}/${eventId}/${uuid}.${ext}`.
alter table public.photos add column if not exists original_filename text;
comment on column public.photos.original_filename is
  'User-provided filename at upload time. Untrusted display-only data — used to suggest a download filename. Pre-existing rows are NULL by design (no backfill).';
