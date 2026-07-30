-- Photo bundles — volume pricing ladder (T-200 design, T-203 ticket A).
--
-- An event may carry an optional LADDER of rungs, each "this many photos or
-- more, for this flat total":
--
--   [{"minQuantity": 3, "totalPriceCents": 1200},
--    {"minQuantity": 8, "totalPriceCents": 2000}]
--
-- A bundle is a PRICE, not a PRODUCT: the purchasable unit stays the individual
-- photo and a completed purchase still writes one order_items row per photo, so
-- every existing entitlement reader (ZIP route, talent library, orders history,
-- guest download token, sold-photo soft delete) is untouched by this column.
--
-- jsonb rather than a child table: the whole ladder is read wherever the event
-- is already read, nothing needs to query or aggregate across rungs, and one
-- nullable column keeps the migration additive. The rules that make a ladder
-- valid (thresholds integer >= 2 and strictly increasing, totals positive and
-- strictly increasing with threshold, each total below minQuantity * price, at
-- or above MIN_PHOTO_PRICE_CENTS, rung count capped) are enforced at WRITE time
-- in the app -- `validateBundleSchedule` in src/lib/bundle-pricing.ts -- and NOT
-- as a CHECK constraint here. Same reasoning as the per-photo price floor
-- (T-195) and the session range (T-180): an event configured under an older rule
-- keeps selling until its ladder is next written, and only the write is
-- rejected. A CHECK would instead break existing rows the day a rule tightens.
--
-- Reads parse defensively and fail CLOSED to "no ladder" (`parseBundleTiers`),
-- which falls back to quantity * unit price. That direction is deliberate: it
-- can only overcharge relative to the photographer's intent -- visible and
-- refundable -- never undercharge, which silently moves money the platform
-- cannot recover.
--
-- Nullable, and null means "no ladder", so existing events are unaffected and
-- rollback is inert: the column simply stops being read.
alter table events add column if not exists bundle_tiers jsonb;

comment on column public.events.bundle_tiers is
  'Optional volume-pricing ladder: array of {minQuantity, totalPriceCents}, ascending. Null = no bundle. Validated in the app at write time (src/lib/bundle-pricing.ts), not by a constraint.';

-- The "all photos" flat price ("Foto-Flat"): the MOST a buyer ever pays for one
-- photographer's photos at this event, however many they take.
--
-- Modelled as a CEILING rather than another rung, deliberately. A rung needs a
-- threshold the photographer would have to derive (ceil(cap / price_per_photo)),
-- and that derived number goes stale the moment the unit price changes — a rung
-- at "4+ for EUR 20" silently stops applying if the price drops to EUR 4, since
-- EUR 20 is then no longer a discount, and nobody is told. A ceiling is one
-- number that keeps meaning what was typed: it engages exactly when
-- quantity * price_per_photo would exceed it, so a buyer with 3 matches still
-- pays per photo while one with 40 pays the flat price.
--
-- Cents, nullable (null = no flat price). Independent of bundle_tiers: an event
-- may set only this, which is the simplest useful configuration ("EUR 5 a photo,
-- or EUR 20 for all of them"). App-level validation only, same reasoning as
-- bundle_tiers above: at or above the floor, strictly above the unit price (at or
-- below it the per-photo price would be unreachable), and strictly above every
-- rung total (a rung at or above the ceiling could never apply).
alter table events add column if not exists bundle_all_photos_cents integer;

comment on column public.events.bundle_all_photos_cents is
  'Optional "all photos" flat price in cents — a ceiling on what a buyer pays for this event, whatever the photo count. Null = none. Validated in the app at write time, not by a constraint.';
