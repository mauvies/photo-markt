-- ============================================================
-- Photographer public profiles
-- ============================================================
-- 1. Add slug + avatar_url columns to profiles
-- 2. Backfill slug from username, avatar_url from auth.users
-- 3. Trigger: auto-set slug = username on INSERT
-- 4. Trigger: sync avatar_url when auth user metadata changes
-- 5. RLS: allow anon/public read of photographer profiles
-- ============================================================

-- 1. Add columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slug       TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Partial unique index (NULL slugs are allowed; multiple NULLs != duplicate)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_idx
  ON public.profiles (slug)
  WHERE slug IS NOT NULL;

-- 2a. Backfill slug = username for all existing rows
UPDATE public.profiles
SET slug = username
WHERE slug IS NULL;

-- 2b. Backfill avatar_url from auth.users for existing rows
UPDATE public.profiles p
SET avatar_url = (u.raw_user_meta_data->>'avatar_url')
FROM auth.users u
WHERE p.id = u.id
  AND p.avatar_url IS NULL
  AND (u.raw_user_meta_data->>'avatar_url') IS NOT NULL;

-- 3. Trigger: auto-set slug = username on INSERT (when caller omits it)
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

-- 4. Trigger: keep avatar_url in sync when user metadata is updated
--    (e.g. Google profile photo refresh after re-login)
CREATE OR REPLACE FUNCTION public.sync_profile_avatar_url()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.raw_user_meta_data->>'avatar_url') IS NOT NULL THEN
    UPDATE public.profiles
    SET avatar_url = NEW.raw_user_meta_data->>'avatar_url'
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_avatar_url ON auth.users;
CREATE TRIGGER trg_sync_profile_avatar_url
  AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_avatar_url();

-- 5. RLS: allow everyone (including anon) to read photographer profiles.
--    Multiple SELECT policies are OR-ed by Postgres, so the existing
--    profiles_self_select policy (id = auth.uid()) is unaffected.
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
