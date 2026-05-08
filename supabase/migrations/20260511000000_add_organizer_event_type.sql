-- Add a third event type ("organizer") on top of the existing two
-- ("solo" = owner-only uploads, "collaborative" = guests can contribute).
-- Organizer events: owner invites specific platform photographers, each
-- accepted photographer uploads their own photos. Owner charges a per-photo
-- fee in addition to the platform fee.

-- 1. New `type` column on events.
--    Encoded as text + check constraint to keep migrations cheap. We keep
--    `is_collaborative` populated at write-time for existing readers; it
--    can be dropped in a follow-up cleanup migration.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'solo'
    CHECK (type IN ('solo', 'collaborative', 'organizer'));

-- Backfill existing rows from the legacy boolean.
UPDATE public.events
SET type = CASE WHEN is_collaborative THEN 'collaborative' ELSE 'solo' END
WHERE type = 'solo' AND is_collaborative IS TRUE;

-- 2. Per-photo organizer fee in cents (nullable; only set for organizer events).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS organizer_fee_per_photo_cents integer
    CHECK (organizer_fee_per_photo_cents IS NULL OR organizer_fee_per_photo_cents >= 0);

-- 3. Membership table: who is invited / approved to upload to which event.
CREATE TABLE IF NOT EXISTS public.event_photographers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  photographer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  invited_by      uuid NOT NULL REFERENCES auth.users(id),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  UNIQUE (event_id, photographer_id)
);

CREATE INDEX IF NOT EXISTS event_photographers_event_idx
  ON public.event_photographers(event_id);

CREATE INDEX IF NOT EXISTS event_photographers_photographer_status_idx
  ON public.event_photographers(photographer_id, status);

ALTER TABLE public.event_photographers ENABLE ROW LEVEL SECURITY;

-- Organizer (event owner) can read all rows for their events.
CREATE POLICY event_photographers_owner_select ON public.event_photographers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_photographers.event_id
        AND e.user_id = auth.uid()
    )
  );

-- Organizer can insert/update/delete invitations for their events.
CREATE POLICY event_photographers_owner_insert ON public.event_photographers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_photographers.event_id
        AND e.user_id = auth.uid()
    )
    AND invited_by = auth.uid()
  );

CREATE POLICY event_photographers_owner_update ON public.event_photographers
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_photographers.event_id
        AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_photographers.event_id
        AND e.user_id = auth.uid()
    )
  );

CREATE POLICY event_photographers_owner_delete ON public.event_photographers
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_photographers.event_id
        AND e.user_id = auth.uid()
    )
  );

-- Photographer can read their own invitation rows...
CREATE POLICY event_photographers_self_select ON public.event_photographers
  FOR SELECT
  USING (photographer_id = auth.uid());

-- ...and respond (accept/decline) only their own pending invitations.
-- The check guards against escalating to states outside the response set.
CREATE POLICY event_photographers_self_respond ON public.event_photographers
  FOR UPDATE
  USING (photographer_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    photographer_id = auth.uid()
    AND status IN ('accepted', 'declined')
  );
