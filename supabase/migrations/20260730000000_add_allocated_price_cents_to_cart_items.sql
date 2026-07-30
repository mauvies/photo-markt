-- Photo bundles — committed per-photo allocation (T-200 design, T-204 ticket B).
--
-- When a volume ladder discounts a set of photos, the buyer is charged ONE
-- discounted total for the set, but the purchasable unit stays the individual
-- photo: the webhook still writes one order_items row per photo, and
-- `createTransfersForOrderItems` transfers `getPhotographerNetCents(gross)` per
-- photographer off `order_items.total_price_cents`.
--
-- So the discounted total has to be SPLIT across the photos, exactly (largest
-- remainder, `allocateBundleTotalCents`). If the rows kept list prices while the
-- buyer paid a discounted total, the platform would transfer money it never
-- collected — a loss on every bundled sale.
--
-- This column is where the checkout COMMITS that split, before the Stripe
-- session is created, so the webhook can READ it instead of recomputing.
-- Recomputing would be wrong, not merely redundant: the ladder is editable at
-- any time, and a photographer who edits it between the charge and the webhook
-- delivery would otherwise produce an order that disagrees with the buyer's card
-- statement. (The guest flow needs no column — it commits the same allocation in
-- the `cart_<i>` metadata `c` field it already writes.)
--
-- Nullable, and null means "no allocation committed": every reader falls back to
-- `unit_price_cents`, which is exactly today's behaviour. That makes the column
-- inert for unbundled carts, keeps sessions created before this deploy correct,
-- and makes rollback a revert with no data migration.
alter table cart_items add column if not exists allocated_price_cents integer;

comment on column public.cart_items.allocated_price_cents is
  'Per-photo share of a bundle-discounted total, committed by checkout before the Stripe session is created and read back by the webhook. Null = no bundle; readers fall back to unit_price_cents. Never recomputed from the event tiers at webhook time.';
