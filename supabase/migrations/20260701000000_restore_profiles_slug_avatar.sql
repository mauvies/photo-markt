-- Restore slug and avatar_url dropped by 20260427162800_remote_schema,
-- which incorrectly undid 20260427000000_photographer_profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slug       TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Partial unique index (NULLs excluded so multiple NULLs don't conflict)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_idx
  ON public.profiles (slug)
  WHERE slug IS NOT NULL;

-- Backfill slug = username for all existing rows
UPDATE public.profiles
SET slug = username
WHERE slug IS NULL;

-- Backfill avatar_url from Google OAuth metadata
UPDATE public.profiles p
SET avatar_url = (u.raw_user_meta_data->>'avatar_url')
FROM auth.users u
WHERE p.id = u.id
  AND p.avatar_url IS NULL
  AND (u.raw_user_meta_data->>'avatar_url') IS NOT NULL;

-- Auto-set slug on INSERT when caller omits it
CREATE OR REPLACE FUNCTION public.set_profile_slug_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := NEW.username;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_profile_slug ON public.profiles;
CREATE TRIGGER trg_set_profile_slug
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_slug_on_insert();

-- Allow everyone (including anon) to read photographer profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'photographer_profiles_public_select'
  ) THEN
    CREATE POLICY photographer_profiles_public_select
      ON public.profiles
      FOR SELECT
      USING (active_role = 'PHOTOGRAPHER');
  END IF;
END
$$;
