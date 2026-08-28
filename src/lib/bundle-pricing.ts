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
 * ⚠️ The price is NOT non-decreasing in quantity, and must not be assumed to be
 * (an earlier version of this comment claimed it was — T-212). A rung whose
 * total falls below `(minQuantity − 1) × unit` prices a smaller set higher: "3
 * for €9" at €5 a photo charges €10 for two and €9 for three. That is not a
 * defect, it is what a volume discount IS — the flagship Foto-Flat shape ("40
 * photos for €19.90") drops from €195 to €19.90 at its threshold, and any rule
 * strong enough to forbid the first also forbids that. The buyer is protected by
 * the `min` above, not by monotonicity: no configuration can ever charge more
 * than buying the same photos one at a time.
 */
export function getBundlePriceCents(
  quantity: number,
  unitPriceCents: number,
  tiers: readonly BundleTier[] | null | undefined,
  allPhotosCents?: number | null,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) return 0;

  if (!BUNDLE_PRICING_ENABLED) return quantity * unitPriceCents;
  return computeSetPriceCents(quantity, unitPriceCents, tiers, allPhotosCents);
}

/**
 * The price rule itself, WITHOUT the kill switch.
 *
 * Split out (T-212) so callers that must reason about the ladder's real shape —
 * validation, and the tests that assert "never more than singles" — can do so
 * even while `BUNDLE_PRICING_ENABLED` is false. Reasoning through the
 * kill-switched entry point would pass vacuously during a rollback and let a
 * broken ladder be saved, to start mispricing the day the switch goes back on.
 */
function computeSetPriceCents(
  quantity: number,
  unitPriceCents: number,
  tiers: readonly BundleTier[] | null | undefined,
  allPhotosCents?: number | null,
): number {
  const listTotal = quantity * unitPriceCents;
  let best = listTotal;

  if (tiers && tiers.length > 0) {
    let applicable: BundleTier | null = null;
    for (const tier of tiers) {
      if (tier.minQuantity > quantity) continue;
      if (applicable === null || tier.minQuantity > applicable.minQuantity) {
        applicable = tier;
      }
    }
    if (applicable !== null) best = Math.min(best, applicable.totalPriceCents);
  }

  // The "all photos" cap (see `BundleAllPhotos` below) is a plain ceiling, so it
  // needs no threshold and applies from whatever quantity first reaches it.
  if (isValidAllPhotosCap(allPhotosCents)) best = Math.min(best, allPhotosCents);

  return best;
}

/**
 * ── The "all photos" flat price ────────────────────────────────────────────
 *
 * `events.bundle_all_photos_cents`: the MOST a buyer ever pays for one
 * photographer's photos at this event, however many they take. Sportograf's
 * "Foto-Flat".
 *
 * Modelled as a **ceiling**, not another rung, and that choice matters:
 *
 * - A rung needs a threshold, and the photographer would have to compute it
 *   (`ceil(cap / unitPrice)`). Worse, that derived threshold goes stale the
 *   moment the unit price changes — a rung at "4+ photos for €20" silently stops
 *   applying if the unit price drops to €4, because €20 is then no longer a
 *   discount, and nobody is told.
 * - A ceiling is one number that means what the photographer said. It engages
 *   exactly when `quantity × unit` would exceed it, so a buyer with 3 matches
 *   still pays per photo while one with 40 pays the flat price. There is no
 *   threshold to pick and nothing to keep in sync.
 *
 * It composes with the rungs through the same `min`, and because it is a
 * constant it can only ever lower the price — never raise it above what the
 * rungs and the unit price already allow.
 *
 * Note the deliberate consequence: a buyer who reaches the cap with only some of
 * their photos pays the same as one who takes all of them — so once they are at
 * the cap, adding the rest is free. That is the Foto-Flat bargain, not a bug.
 */
function isValidAllPhotosCap(cents: number | null | undefined): cents is number {
  return typeof cents === 'number' && Number.isFinite(cents) && cents > 0;
}

/** Whether an event's "all photos" flat price is set and usable. */
export function hasAllPhotosPrice(cents: number | null | undefined): boolean {
  return BUNDLE_PRICING_ENABLED && isValidAllPhotosCap(cents);
}

/**
 * The photo count at which the "all photos" ceiling starts being the cheaper
 * option — `ceil(cap / unit)`.
 *
 * The ceiling deliberately carries no threshold (that is the whole point: a
 * derived threshold goes stale when the unit price changes), but the photographer
 * still wants to know where it engages, and so does the read-only pricing tab.
 * Derived on demand from the two live values, never stored, so it cannot go
 * stale. Returns null when either input makes the question meaningless.
 */
export function getAllPhotosBreakEvenQuantity(
  allPhotosCents: number | null | undefined,
  unitPriceCents: number | null | undefined,
): number | null {
  if (!isValidAllPhotosCap(allPhotosCents)) return null;
  if (typeof unitPriceCents !== 'number' || !Number.isFinite(unitPriceCents)) return null;
  if (unitPriceCents <= 0) return null;
  return Math.ceil(allPhotosCents / unitPriceCents);
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
  allPhotosCents?: number | null,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) return 0;
  const listTotal = quantity * unitPriceCents;
  // The ceiling MUST be forwarded (T-212). Without it this reported a 0
  // discount on exactly the carts the Foto-Flat binds — a cart charged €20
  // would have rendered "subtotal €50, discount €0", which is the
  // displayed-vs-charged divergence the single-calc-point rule exists to
  // prevent.
  return listTotal - getBundlePriceCents(quantity, unitPriceCents, tiers, allPhotosCents);
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
  | 'total_not_a_discount'
  | 'not_parseable'
  | 'all_photos_below_floor'
  | 'all_photos_not_above_unit'
  | 'all_photos_below_a_pack';

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
  allPhotosCents?: number | null,
): BundleScheduleValidation {
  // The "all photos" ceiling is independent of the rungs — an event may set it
  // with no rungs at all, which is the simplest useful configuration ("€5 a
  // photo, or €20 for all of them").
  if (isValidAllPhotosCap(allPhotosCents)) {
    if (!Number.isInteger(allPhotosCents)) return { ok: false, error: 'total_not_integer' };
    if (allPhotosCents < minPhotoPriceCents) {
      return { ok: false, error: 'all_photos_below_floor', minCents: minPhotoPriceCents };
    }
    // At or below the unit price the ceiling would apply to a single photo too,
    // making the per-photo price unreachable — that is a cheaper unit price
    // being expressed in the wrong field, not a bundle.
    if (allPhotosCents <= unitPriceCents) {
      return { ok: false, error: 'all_photos_not_above_unit' };
    }
    // A rung at or above the ceiling can never apply, so it is dead config the
    // photographer would believe was live.
    for (const tier of tiers) {
      if (tier.totalPriceCents >= allPhotosCents) {
        return { ok: false, error: 'all_photos_below_a_pack' };
      }
    }
  }

  // With a ceiling set, an empty rung list is a complete, valid configuration.
  if (tiers.length === 0) {
    return isValidAllPhotosCap(allPhotosCents) ? { ok: true } : { ok: false, error: 'empty' };
  }
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

  // ── On monotonicity: NOT enforced, and deliberately so (T-212) ────────────
  //
  // A code review flagged that nothing ties a rung total to
  // `(minQuantity − 1) × unit`, so "€5 a photo, 3 for €9" prices 2 photos at €10
  // and 3 at €9 — removing a photo RAISES the total — while `CLAUDE.md` claimed
  // the price was "non-decreasing in quantity". The claim was false. The
  // conclusion drawn from it was too.
  //
  // Enforcing it would forbid the product's flagship shape: the Foto-Flat rung
  // "40 photos for €19.90" prices 39 photos at €195 and 40 at €19.90, a far
  // bigger drop, and it is exactly what Sportograf-style volume pricing IS. Any
  // rule strong enough to reject "3 for €9" also rejects that.
  //
  // What actually protects the buyer is the guard that IS enforced, in
  // `computeSetPriceCents`: `min(quantity × unit, …)` makes it structurally
  // impossible for any configuration, however odd, to charge MORE than buying
  // the same photos one at a time. A ladder that dips below the quantity beneath
  // it is a published, visible discount — not an overcharge. The docs now say
  // this instead of promising monotonicity.
  return { ok: true };
}

/** Convenience predicate for call sites that only need the yes/no. */
export function isValidBundleSchedule(
  tiers: readonly BundleTier[],
  unitPriceCents: number,
  minPhotoPriceCents: number = MIN_PHOTO_PRICE_CENTS,
  allPhotosCents?: number | null,
): boolean {
  return validateBundleSchedule(tiers, unitPriceCents, minPhotoPriceCents, allPhotosCents).ok;
}

/**
 * Parse a submitted "all photos" price, failing closed to null.
 *
 * Same read/write asymmetry as the rungs is NOT needed here: there is one number
 * and no cross-rung ordering to report, so a structurally invalid value is
 * simply absent, and the semantic checks live in `validateBundleSchedule`.
 */
export function parseAllPhotosCents(raw: unknown): number | null {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
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

/**
 * ── The three states a submitted ladder can be in (T-212) ──────────────────
 *
 * `parseBundleTiersInput` collapses "the form didn't send the field", "the
 * photographer cleared it" and "this doesn't parse" into a single `null`, and
 * the write paths then read that null as "clear the ladder". So vaciar un campo,
 * typing `1` in a threshold, or a stored ladder the reader rejects all DELETED
 * the photographer's pricing while reporting success — silent data loss on a
 * money column, and the reason `quantity_too_low` was an unreachable message.
 *
 * Keeping the three apart is the fix the rest of this ticket hangs off:
 *  - `absent`  → the field was not part of this form; DON'T TOUCH the column.
 *  - `cleared` → the photographer explicitly emptied it; write null.
 *  - `invalid` → reject the save and name the reason; never write.
 *  - `tiers`   → validate against the price, then write.
 */
export type BundleTiersSubmission =
  | { kind: 'absent' }
  | { kind: 'cleared' }
  | { kind: 'invalid'; error: BundleScheduleError }
  | { kind: 'tiers'; tiers: BundleTier[] };

export function parseBundleTiersSubmission(raw: unknown): BundleTiersSubmission {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  if (typeof raw === 'string' && raw.trim() === '') return { kind: 'cleared' };

  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { kind: 'invalid', error: 'not_parseable' };
    }
  }

  if (!Array.isArray(value)) return { kind: 'invalid', error: 'not_parseable' };
  // An empty list is the editor's "I removed every pack", not corruption.
  if (value.length === 0) return { kind: 'cleared' };
  if (value.length > MAX_BUNDLE_TIERS) return { kind: 'invalid', error: 'too_many_tiers' };

  const tiers: BundleTier[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return { kind: 'invalid', error: 'not_parseable' };
    }
    const record = entry as Record<string, unknown>;
    const minQuantity = record.minQuantity ?? record.min_quantity;
    const totalPriceCents = record.totalPriceCents ?? record.total_price_cents;

    // Each of these used to be a silent `null`. They are the exact values the
    // editor produces from a cleared box or a typed `1`, so they are the common
    // case, not corruption — and each now names itself to the photographer.
    if (typeof minQuantity !== 'number' || !Number.isInteger(minQuantity)) {
      return { kind: 'invalid', error: 'quantity_not_integer' };
    }
    if (minQuantity < MIN_BUNDLE_TIER_QUANTITY) {
      return { kind: 'invalid', error: 'quantity_too_low' };
    }
    if (typeof totalPriceCents !== 'number' || !Number.isInteger(totalPriceCents)) {
      return { kind: 'invalid', error: 'total_not_integer' };
    }
    if (totalPriceCents <= 0) return { kind: 'invalid', error: 'total_not_integer' };

    tiers.push({ minQuantity, totalPriceCents });
  }

  tiers.sort((a, b) => a.minQuantity - b.minQuantity);
  return { kind: 'tiers', tiers };
}

/** The same three states for the "all photos" ceiling. */
export type AllPhotosSubmission =
  | { kind: 'absent' }
  | { kind: 'cleared' }
  | { kind: 'invalid'; error: BundleScheduleError }
  | { kind: 'cents'; cents: number };

export function parseAllPhotosSubmission(raw: unknown): AllPhotosSubmission {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  if (typeof raw === 'string' && raw.trim() === '') return { kind: 'cleared' };

  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { kind: 'invalid', error: 'not_parseable' };
  }
  // Zero is how the editor reports a cleared amount box, and "no flat price" is
  // what the photographer means by it.
  if (value === 0) return { kind: 'cleared' };
  if (value < 0) return { kind: 'invalid', error: 'not_parseable' };
  return { kind: 'cents', cents: value };
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
 * The single most compelling offer on an event, for the surfaces that have room
 * for one line and not a table (T-204): the meta line that feeds event cards,
 * the purchase modal above add-to-cart, the selection toolbar.
 *
 * "Most compelling" is the deepest one: the "all photos" ceiling when set (it is
 * strictly above every rung total by validation, and it is the offer that needs
 * no threshold at all), otherwise the highest rung — the biggest saving per
 * photo, and the one whose per-photo price reads lowest.
 *
 * Returns null when the event has no ladder, so an unbundled event's card and
 * modal render exactly as they did before bundles existed.
 */
export type BundleOffer =
  | { kind: 'all-photos'; totalCents: number }
  | { kind: 'tier'; minQuantity: number; totalCents: number };

export function getBestBundleOffer(
  tiers: readonly BundleTier[] | null | undefined,
  allPhotosCents?: number | null,
): BundleOffer | null {
  if (!BUNDLE_PRICING_ENABLED) return null;

  if (isValidAllPhotosCap(allPhotosCents)) {
    return { kind: 'all-photos', totalCents: allPhotosCents };
  }

  if (!tiers || tiers.length === 0) return null;

  let best: BundleTier | null = null;
  for (const tier of tiers) {
    if (best === null || tier.minQuantity > best.minQuantity) best = tier;
  }
  if (best === null) return null;

  return { kind: 'tier', minQuantity: best.minQuantity, totalCents: best.totalPriceCents };
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
 * without their consent. There is also nothing to split it against — organizer
 * revenue sharing does not exist (T-219 removed the fee field that pretended
 * otherwise), so a discount has no agreed way to be apportioned.
 *
 * Free events are exempt for the same reason the price floor exempts them:
 * there is nothing to discount.
 */
export function eventSupportsBundles(event: {
  type?: string | null;
  price_per_photo?: number | null;
}): boolean {
  if (!BUNDLE_PRICING_ENABLED) return false;
  return eventAcceptsBundleConfig(event);
}

/**
 * Whether an event's OWN properties permit a stored ladder — deliberately
 * ignoring `BUNDLE_PRICING_ENABLED`.
 *
 * This is the predicate every WRITE path must use, and the distinction is the
 * whole point (T-212). `eventSupportsBundles` folds in the kill switch, which is
 * right for hiding UI but catastrophic for a write: flipping the switch to roll
 * back made every edit action see "this event can't have a ladder" and normalize
 * the stored columns to null, so the next save of ANY kind — a rename, a
 * settings toggle — permanently erased the photographer's pricing. That is the
 * exact opposite of the property the switch advertises ("stored ladders survive
 * it unread, so rollback needs no migration"): rollback has to be inert, and
 * inert means the write paths keep their hands off the columns.
 */
export function eventAcceptsBundleConfig(event: {
  type?: string | null;
  price_per_photo?: number | null;
}): boolean {
  if (event.type === 'organizer') return false;
  const price = event.price_per_photo;
  if (price === null || price === undefined || price <= 0) return false;
  return true;
}
