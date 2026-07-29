/**
 * Photographer subscription plans configuration
 */

import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';

export type PlanId = 'free' | 'starter' | 'pro';

/**
 * Hard ceiling on photos per single event, applied uniformly across plan
 * tiers. Enforced in the upload flow's `createPhotoUploadUrls` server
 * action; not a DB CHECK because counting 5000 rows per call would be
 * wasteful relative to the per-batch precheck we do once.
 */
export const MAX_PHOTOS_PER_EVENT = 5000;

export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanPricing {
  /** Monthly recurring price (EUR), shown when the user picks "monthly". */
  monthly: number;
  /** Lump-sum yearly recurring price (EUR), what Stripe actually charges. */
  yearlyTotal: number;
  /**
   * Display-only: `yearlyTotal / 12`. We show this on the pricing cards
   * when "yearly" is selected so users see the per-month equivalent.
   */
  yearlyMonthlyEquivalent: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** null for the Free plan. */
  pricing: PlanPricing | null;
  description: string;
  storageGB: number | null; // null for unlimited
  maxEvents: number | null; // null for unlimited
  salesFeePercent: number;
  allowCustomBundles: boolean;
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    pricing: null,
    description: 'Perfect for getting started and testing Photo Markt',
    storageGB: 20,
    maxEvents: 5,
    salesFeePercent: 12,
    allowCustomBundles: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    // Repriced to 9.99 in billing v2 (T-194/T-195): with Pro heading to 0%
    // commission, Starter at 14.99 was economically dominated — each tier now
    // owns a real GMV band (Free <250 · Starter 250–500 · Pro >500/mo). The
    // live Stripe Price objects were recreated at €9.99 on 2026-07-28, so this
    // is what keeps the card and the charge in agreement.
    // 20% off yearly — 9.99 * 12 = 119.88, charged as 95.88 → the
    // per-month-equivalent shown on the yearly card is 95.88 / 12 = 7.99.
    pricing: { monthly: 9.99, yearlyTotal: 95.88, yearlyMonthlyEquivalent: 7.99 },
    description: 'For active creators who publish events regularly',
    storageGB: 50,
    // Marketing copy advertises "Unlimited events" on Starter; null = no cap.
    maxEvents: null,
    salesFeePercent: 8,
    allowCustomBundles: true,
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    // Same 20% off yearly structure as Starter — 29.99 * 12 = 359.88, charged
    // as 287.88 → 287.88 / 12 = 23.99 per-month equivalent.
    pricing: { monthly: 29.99, yearlyTotal: 287.88, yearlyMonthlyEquivalent: 23.99 },
    description: 'For professional photographers and studios',
    storageGB: 250,
    maxEvents: null, // Unlimited
    salesFeePercent: 5,
    allowCustomBundles: true,
  },
];

/**
 * Platform commission rate per plan, as a 0–1 fraction. Single source of truth:
 * derived from each plan's `salesFeePercent` so the advertised "% sales fee" and
 * the fee actually applied in the Stripe webhook / earnings can never diverge.
 *
 * Billing v2 (T-194) lowers these to 8/4/0, but that change ships with T-196,
 * NOT here: the webhook transfers `getPhotographerNetCents(gross)` and the
 * platform absorbs Stripe's cost, so dropping Pro to 0% before the buyer fee is
 * live would make every Pro sale a loss. The two must deploy together.
 */
export const PLATFORM_FEE_RATES: Record<PlanId, number> = Object.fromEntries(
  PLANS.map((plan) => [plan.id, plan.salesFeePercent / 100]),
) as Record<PlanId, number>;

export function getPlatformFeeRate(planId: string | null | undefined): number {
  if (planId && planId in PLATFORM_FEE_RATES) {
    return PLATFORM_FEE_RATES[planId as PlanId];
  }
  return PLATFORM_FEE_RATES.free;
}

export function getPhotographerNetCents(
  totalPriceCents: number,
  planId: string | null | undefined,
): number {
  return Math.floor(totalPriceCents * (1 - getPlatformFeeRate(planId)));
}

/* ── Billing model v2 — buyer service fee + minimum photo price (T-194/T-195) ──
 *
 * These are deliberately plain constants, NOT environment variables. They set
 * what every buyer is charged, so the review trail matters more than the
 * ability to change them without a deploy: a constant gives a diff, a PR, a
 * reviewer and a revertible commit, and a typo (3000 instead of 30) gets caught
 * by a human instead of silently charging €30 a head. An env var would also
 * drift silently between staging and prod, and would force this module to be
 * server-only — which it is not, so the cart can compute the fee it displays
 * from the same function the checkout charges from.
 *
 * Shipping at 0 is the dark launch: 0 reproduces the pre-v2 behaviour exactly
 * (no fee charged, no fee line item, no price floor). Turning v2 on is a
 * one-line change to these values; rolling back is reverting that commit.
 *
 * Set them only after measuring the real Stripe fee distribution, sized to the
 * WORST realistic case — at Pro 0% commission the buyer fee is the only thing
 * covering Stripe on that sale. Provisional targets from the design: 30 cents +
 * 150 bps, floor 150.
 */

/** Fixed component of the buyer service fee, in cents. 0 = disabled. */
export const BUYER_SERVICE_FEE_FIXED_CENTS = 0;

/** Percent component of the buyer service fee, in basis points. 0 = disabled. */
export const BUYER_SERVICE_FEE_BPS = 0;

/**
 * Floor on a PRICED event's `price_per_photo`, in cents, so the fixed part of
 * the fee is never disproportionate to the item. 0 = no floor.
 */
export const MIN_PHOTO_PRICE_CENTS = 0;

/**
 * The pure fee kernel. Exported so the arithmetic can be exercised at values we
 * have not shipped yet; production code must call `getBuyerServiceFeeCents`
 * instead, which is the one place that binds the configured amounts.
 *
 * Rounding is a single `Math.round` on the percent component, so a given
 * subtotal always yields the same integer number of cents.
 *
 * A non-positive subtotal yields 0: an empty or free cart produces no charge,
 * so it must not produce a lone fee line item either.
 */
export function computeBuyerServiceFeeCents(
  subtotalCents: number,
  fixedCents: number,
  bps: number,
): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return fixedCents + Math.round((subtotalCents * bps) / 10000);
}

/**
 * THE single calc point for the buyer service fee.
 *
 * `fee = BUYER_SERVICE_FEE_FIXED_CENTS + round(subtotalCents × BPS / 10000)`
 *
 * Charged to the buyer on top of the cart subtotal, as its own visible Stripe
 * line item. No checkout, cart, or earnings path may re-derive it inline — both
 * the charged amount and the displayed amount must come from here, or they can
 * diverge (and a receipt that disagrees with the cart is the legal risk under
 * PSD2: the flat fee itself is lawful, surprise pricing is not).
 *
 * Safe to call from the browser as well as the server, so the cart can display
 * exactly what the checkout will charge.
 */
export function getBuyerServiceFeeCents(subtotalCents: number): number {
  return computeBuyerServiceFeeCents(
    subtotalCents,
    BUYER_SERVICE_FEE_FIXED_CENTS,
    BUYER_SERVICE_FEE_BPS,
  );
}

/**
 * Whether a photo price clears the floor. The one predicate both event-write
 * paths (create + edit) use, so they can't drift apart.
 *
 * `minCents` is required rather than defaulted: every caller states which floor
 * it is enforcing, which is also what lets a test drive the rule at a value we
 * have not shipped.
 *
 * Free events are exempt: `null`, `undefined` and `0` all mean "not for sale"
 * and are always allowed. The floor only ever constrains a *positive* price,
 * and a floor of 0 accepts everything. It is enforced at write time (not as a
 * DB constraint) so events priced below a later-raised floor keep working until
 * their price is next written.
 */
export function isPhotoPriceAboveFloor(
  pricePerPhotoCents: number | null | undefined,
  minCents: number,
): boolean {
  if (pricePerPhotoCents === null || pricePerPhotoCents === undefined) return true;
  if (pricePerPhotoCents <= 0) return true;
  return pricePerPhotoCents >= minCents;
}

export function getPlanById(id: PlanId): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/**
 * Format a plan's price for display. Defaults to monthly. For yearly, shows
 * the per-month-equivalent (which is what the home page does) — the
 * "billed yearly: $X" subtitle is rendered separately by the calling UI.
 */
export function formatPlanPrice(plan: Plan, period: BillingPeriod = 'monthly'): string {
  if (plan.pricing === null) {
    return 'Free';
  }
  const amount = period === 'yearly' ? plan.pricing.yearlyMonthlyEquivalent : plan.pricing.monthly;
  return `${PLATFORM_CURRENCY_SYMBOL}${amount}/mo`;
}
