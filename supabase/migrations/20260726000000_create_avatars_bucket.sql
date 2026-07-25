-- Provision the `avatars` storage bucket via migration (T-182).
--
-- Profile pictures are rendered as plain `<img src>` on PUBLIC pages
-- (photographer profile, event cards, header), so the bucket must be
-- world-readable — unlike `photos` (private, signed URLs). Hence `public: true`.
--
-- Writes are NOT open: storage.objects has RLS enabled with no INSERT/UPDATE/
-- DELETE policy for this bucket, so anon/authenticated cannot write directly.
-- The only writer is the avatar Server Action, which uses the service-role
-- client (bypasses RLS) and derives the object path from the authenticated
-- user's id (`<userId>/<uuid>.webp`) — same trust model as the photo flow.
-- The action also validates magic bytes + size and re-encodes to WebP before
-- upload, so bucket-level MIME/size limits are redundant and omitted (mirrors
-- the `photos` bucket).
--
-- Idempotent so re-runs and any already-created bucket are left untouched.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
