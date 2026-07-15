-- T-134: persist the access proof a buyer presented when adding a private-event
-- photo to their authenticated cart, so authenticated checkout can re-validate
-- accessibility (parity with the guest checkout) and close the public->private
-- flip charge.
--
-- T-132 gated add-to-cart / guest merge / guest checkout on "event public OR
-- matching share code presented", but `cart_items` never recorded the code the
-- caller presented, so authed checkout couldn't tell a legitimate private
-- purchase (added with the right code) from a photo added while the event was
-- public and only later flipped private. This column captures that proof at add
-- time. Nullable: a caller presenting no code (public event, or the favorites/
-- tag path) stores null; legacy rows sit at null and fail closed for private
-- events at checkout unless the buyer still holds the tag (the safe direction).
--
-- Additive, idempotent, rollback-inert: dropping the column only loses the proof
-- (checkout then fails closed for private items) — no data corruption. Existing
-- `cart_items` RLS already scopes rows to their owning cart's user, so no policy
-- change is needed.
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS access_share_code text;
