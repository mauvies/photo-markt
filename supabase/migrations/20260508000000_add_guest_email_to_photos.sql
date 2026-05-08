-- Optional contact for guests who contribute photos to a collaborative event.
-- Captured alongside guest_name in the same upload form; nullable so existing
-- rows and authenticated uploads are unaffected.

ALTER TABLE public.photos ADD COLUMN guest_email text;
