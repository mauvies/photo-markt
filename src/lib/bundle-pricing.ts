/**
 * Photo bundles — volume pricing ladder (T-200 design, T-203 ticket A).
 *
 * A bundle is a PRICE, not a PRODUCT. The purchasable unit stays the individual
 * photo; an event may carry an optional ladder that changes what a *set* costs.
 * Nothing here creates an entitlement, so every existing order/download/library
 * reader keeps working untouched.
 *
 * This module is deliberately **client-safe** — no `env.mjs`, no server-only
 * import — so the cart can display the price the checkout charges from. That is
 * the same discipline `getBuyerServiceFeeCents` follows in `plans.ts`, and it is
 * what makes displayed-vs-charged divergence structurally impossible rather than
 * merely test-enforced.
 */

import { MIN_PHOTO_PRICE_CENTS } from '@/lib/plans';

/**
 * One rung of the ladder: "this many photos or more, for this flat total".
 *
 * Cents throughout, like every other money value that crosses a boundary here —
 * `events.price_per_photo` is the odd one out (euros, `numeric(10,2)`), so call
 * sites convert explicitly rather than letting two units meet by accident.
 */
export interface BundleTier {
  /** Photo count at which this rung starts applying. Integer ≥ 2. */
  minQuantity: number;
  /** Flat total for the whole set once the rung applies. Positive integer. */
  totalPriceCents: number;
}

/**
 * Global kill switch. `false` makes `getBundlePriceCents` return
 * `quantity × unit` for every event regardless of stored ladders, and callers
 * suppress every bundle affordance.
 *
 * Stored ladders survive being disabled — they are simply not read — so rollback
 * is a one-line revert with no data migration and no repricing of historical
 * orders. Same escape hatch billing v2 shipped with.
 */
export const BUNDLE_PRICING_ENABLED = true;

/**
 * Ceiling on rungs per event. Keeps the ladder readable in a card, a meta line
 * and a review step, and bounds the parse of untrusted stored JSON.
 */
export const MAX_BUNDLE_TIERS = 4;

/** Lowest threshold that means anything — a "1 or more" rung is just the unit price. */
export const MIN_BUNDLE_TIER_QUANTITY = 2;

/**
 * THE single calc point for what a set of photos costs.
 *
 * The applicable rung is the one with the GREATEST `minQuantity ≤ quantity` —
 * **not** the cheapest rung whose threshold is met. That distinction is the
 * whole ladder: taking the minimum across every applicable rung would let a
 * cheap low rung shadow every rung above it, so in
 * "1 photo €5 · 3+ €12 · 8+ €20" a buyer taking 20 photos would pay €12 and the
 * €20 rung could never apply.
 *
 * The `min` against `quantity × unitPriceCents` is a separate guard: it makes it
 * structurally impossible for a rung to charge MORE than buying the same photos
 * singly, whatever the configured values.
 *
 * Together with the validation rule that totals strictly increase with
 * threshold (`isValidBundleSchedule`), the resulting price is **non-decreasing
 * in quantity**: inside a rung's band `quantity × unit` only grows, and at a
 * crossing the rung total steps up. Adding a photo never makes a cart cheaper.
 */
export function getBundlePriceCents(
  quantity: number,
  unitPriceCents: number,
  tiers: readonly BundleTier[] | null | undefined,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) return 0;

  const listTotal = quantity * unitPriceCents;
  if (!BUNDLE_PRICING_ENABLED || !tiers || tiers.length === 0) return listTotal;

  let applicable: BundleTier | null = null;
  for (const tier of tiers) {
    if (tier.minQuantity > quantity) continue;
    if (applicable === null || tier.minQuantity > applicable.minQuantity) {
      applicable = tier;
    }
  }

  if (applicable === null) return listTotal;
  return Math.min(listTotal, applicable.totalPriceCents);
}

/**
 * The next rung a buyer has not reached yet, or null when none remains — the
 * input to the cart's "add 2 more photos and pay €X" prompt.
 *
 * Returns the LOWEST unreached threshold: that is the one the buyer can actually
 * act on next. Ordering of the stored array is not assumed.
 */
export function getNextBundleTier(
  quantity: number,
  tiers: readonly BundleTier[] | null | undefined,
): BundleTier | null {
  if (!BUNDLE_PRICING_ENABLED || !tiers || tiers.length === 0) return null;

  let next: BundleTier | null = null;
  for (const tier of tiers) {
    if (tier.minQuantity <= quantity) continue;
    if (next === null || tier.minQuantity < next.minQuantity) {
      next = tier;
    }
  }
  return next;
}

/**
 * The discount a ladder is taking off this particular set, in cents — what the
 * cart shows on its own line. Zero when no rung applies, so callers render the
 * pre-bundle summary unchanged.
 */
export function getBundleDiscountCents(
  quantity: number,
  unitPriceCents: number,
  tiers: readonly BundleTier[] | null | undefined,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) return 0;
  const listTotal = quantity * unitPriceCents;
  return listTotal - getBundlePriceCents(quantity, unitPriceCents, tiers);
}

/**
 * Split a total across `count` photos as whole cents summing to EXACTLY the
 * total, by largest remainder.
 *
 * This is the load-bearing half of the feature. `order_items.unit_price_cents`
 * feeds `createTransfersForOrderItems`, which transfers
 * `getPhotographerNetCents(gross)` per photographer — so if the rows kept list
 * prices while the buyer paid a discounted total, the platform would transfer
 * money it never collected. Allocating exactly means transfers, earnings,
 * `orders.total_amount_cents`, the `gross = commission + net` identity (T-197)
 * and refunds all stay correct with no change to any of them.
 *
 * Deterministic: the remainder cent goes to the earliest indices, so the same
 * set always produces the same amounts and a test can assert them.
 */
export function allocateBundleTotalCents(totalCents: number, count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (!Number.isFinite(totalCents) || totalCents <= 0) return new Array(count).fill(0);

  const total = Math.round(totalCents);
  const base = Math.floor(total / count);
  const remainder = total - base * count;

  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base));
}

/**
 * Why a ladder was rejected. Returned rather than thrown so the write paths can
 * map it to their own error channel, and so tests name the rule they exercise.
 */
export type BundleScheduleError =
  | 'empty'
  | 'too_many_tiers'
  | 'quantity_not_integer'
  | 'quantity_too_low'
  | 'quantity_not_increasing'
  | 'total_not_integer'
  | 'total_below_floor'
  | 'total_not_increasing'
  | 'total_not_a_discount';

export interface BundleScheduleValidation {
  ok: boolean;
  error?: BundleScheduleError;
  /** Set for `total_below_floor` so the caller can state the actual floor. */
  minCents?: number;
}

/**
 * Validate a ladder against a unit price, at WRITE time.
 *
 * App-level rather than a DB constraint, matching `isPhotoPriceAboveFloor` and
 * `isValidSessionRange`: an event configured under an older rule keeps selling
 * until its ladder is next written, and only the write is rejected.
 *
 * `minPhotoPriceCents` is a parameter rather than a default so every caller
 * states which floor it is enforcing — and so a test can drive the rule at a
 * value we have not shipped.
 *
 * The rules, and why each exists:
 * - thresholds integer ≥ 2, strictly increasing — a "1+" rung is the unit price,
 *   and duplicates make the applicable rung ambiguous;
 * - totals positive integers ≥ the floor, applied to the **rung total** rather
 *   than per photo: the floor exists so the fixed part of the buyer service fee
 *   is never disproportionate to what is being bought, and for a bundle that is
 *   the set (a €19.90 bundle of 40 photos carries a €0.85 fee, which is fine —
 *   a per-photo reading would forbid it);
 * - totals strictly increasing with threshold — WITHOUT THIS THE LADDER
 *   COLLAPSES, because a cheap high rung would price every quantity above its
 *   threshold below the rung the photographer intended;
 * - each total strictly below `minQuantity × unit` — a rung that is not a
 *   discount can never apply, so saving it is a silent no-op.
 */
export function validateBundleSchedule(
  tiers: readonly BundleTier[],
  unitPriceCents: number,
  minPhotoPriceCents: number,
): BundleScheduleValidation {
  if (tiers.length === 0) return { ok: false, error: 'empty' };
  if (tiers.length > MAX_BUNDLE_TIERS) return { ok: false, error: 'too_many_tiers' };

  let previous: BundleTier | null = null;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minQuantity)) return { ok: false, error: 'quantity_not_integer' };
    if (tier.minQuantity < MIN_BUNDLE_TIER_QUANTITY) {
      return { ok: false, error: 'quantity_too_low' };
    }
    if (!Number.isInteger(tier.totalPriceCents)) return { ok: false, error: 'total_not_integer' };
    if (tier.totalPriceCents <= 0) return { ok: false, error: 'total_not_integer' };
    if (tier.totalPriceCents < minPhotoPriceCents) {
      return { ok: false, error: 'total_below_floor', minCents: minPhotoPriceCents };
    }
    if (tier.totalPriceCents >= tier.minQuantity * unitPriceCents) {
      return { ok: false, error: 'total_not_a_discount' };
    }
    if (previous !== null) {
      if (tier.minQuantity <= previous.minQuantity) {
        return { ok: false, error: 'quantity_not_increasing' };
      }
      if (tier.totalPriceCents <= previous.totalPriceCents) {
        return { ok: false, error: 'total_not_increasing' };
      }
    }
    previous = tier;
  }

  return { ok: true };
}

/** Convenience predicate for call sites that only need the yes/no. */
export function isValidBundleSchedule(
  tiers: readonly BundleTier[],
  unitPriceCents: number,
  minPhotoPriceCents: number = MIN_PHOTO_PRICE_CENTS,
): boolean {
  return validateBundleSchedule(tiers, unitPriceCents, minPhotoPriceCents).ok;
}

/**
 * Parse a ladder out of untrusted stored JSON, FAILING CLOSED to `null`.
 *
 * Failing closed here means every price path falls back to
 * `quantity × unitPriceCents`. That direction is deliberate: it can only ever
 * overcharge relative to the photographer's intent — visible and refundable —
 * never undercharge, which silently moves money the platform cannot recover.
 *
 * Structural validation only (shape, integers, ordering, cap). The
 * unit-price-dependent rules live in `validateBundleSchedule` at write time,
 * because a read has no business rejecting a ladder just because the price was
 * lowered afterwards — `getBundlePriceCents` already refuses to overcharge.
 */
export function parseBundleTiers(raw: unknown): BundleTier[] | null {
  const tiers = parseBundleTiersInput(raw);
  if (tiers === null) return null;

  for (let i = 1; i < tiers.length; i++) {
    // Duplicated thresholds make the applicable rung ambiguous, and a
    // non-increasing total collapses the ladder — both are corruption at READ
    // time, so fail closed rather than guess which rung was meant.
    if (tiers[i].minQuantity === tiers[i - 1].minQuantity) return null;
    if (tiers[i].totalPriceCents <= tiers[i - 1].totalPriceCents) return null;
  }

  return tiers;
}

/**
 * Parse SUBMITTED tiers — shape only, deliberately more permissive than
 * `parseBundleTiers`.
 *
 * The distinction matters and is not cosmetic. On a read, an inconsistent stored
 * ladder is corruption and failing closed to "no ladder" is the safe direction.
 * On a WRITE, failing closed would silently discard what the photographer typed
 * and report success — they would save a collapsing ladder, be told nothing, and
 * find their pricing gone. So input parsing accepts any structurally sound list
 * and leaves the semantic rules (ordering, monotonic totals, the floor, "is it
 * actually a discount") to `validateBundleSchedule`, which names the violation so
 * the form can explain it.
 *
 * Returns null only when there is nothing usable to validate at all — not an
 * array, empty, past the cap, or an entry that isn't a pair of positive integers.
 */
export function parseBundleTiersInput(raw: unknown): BundleTier[] | null {
  if (raw === null || raw === undefined) return null;

  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_BUNDLE_TIERS) return null;

  const tiers: BundleTier[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const minQuantity = record.minQuantity ?? record.min_quantity;
    const totalPriceCents = record.totalPriceCents ?? record.total_price_cents;

    if (typeof minQuantity !== 'number' || !Number.isInteger(minQuantity)) return null;
    if (minQuantity < MIN_BUNDLE_TIER_QUANTITY) return null;
    if (typeof totalPriceCents !== 'number' || !Number.isInteger(totalPriceCents)) return null;
    if (totalPriceCents <= 0) return null;

    tiers.push({ minQuantity, totalPriceCents });
  }

  // Normalize order so `getBundlePriceCents`, every display path and the
  // validator all see the same sequence regardless of how it was submitted.
  tiers.sort((a, b) => a.minQuantity - b.minQuantity);

  return tiers;
}

/** Serialize for storage. Kept beside the parser so the two can't drift. */
export function serializeBundleTiers(tiers: readonly BundleTier[] | null): BundleTier[] | null {
  if (!tiers || tiers.length === 0) return null;
  return tiers.map((tier) => ({
    minQuantity: tier.minQuantity,
    totalPriceCents: tier.totalPriceCents,
  }));
}

/**
 * Effective per-photo price at a rung's own threshold, in cents — what the
 * editor shows as the photographer types and what the read-only ladder table
 * displays, so "8 for €20" reads as "€2.50 each".
 */
export function getEffectivePerPhotoCents(tier: BundleTier): number {
  if (tier.minQuantity <= 0) return 0;
  return Math.round(tier.totalPriceCents / tier.minQuantity);
}

/**
 * Whether an event may carry a ladder at all.
 *
 * Organizer events are excluded: an accepted contributor's uploads carry that
 * contributor's `photos.user_id`, so one event can span several sellers, and a
 * discount set by the organizer would cut another photographer's revenue
 * without their consent. There is also nothing to split it against —
 * `organizer_fee_per_photo_cents` is written at event creation and read by no
 * money path, so organizer revenue sharing does not exist yet.
 *
 * Free events are exempt for the same reason the price floor exempts them:
 * there is nothing to discount.
 */
export function eventSupportsBundles(event: {
  type?: string | null;
  price_per_photo?: number | null;
}): boolean {
  if (!BUNDLE_PRICING_ENABLED) return false;
  if (event.type === 'organizer') return false;
  const price = event.price_per_photo;
  if (price === null || price === undefined || price <= 0) return false;
  return true;
}
