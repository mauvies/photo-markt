/**
 * Photographer subscription plans configuration
 */

import { env } from '@/env.mjs';
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
    salesFeePercent: 8,
    allowCustomBundles: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    // Repriced to 9.99 in billing v2 (T-194): with Pro at 0% commission,
    // Starter at 14.99 was economically dominated — each tier now owns a real
    // GMV band (Free <250 · Starter 250–500 · Pro >500/mo).
    // 20% off yearly — 9.99 * 12 = 119.88, charged as 95.88 → the
    // per-month-equivalent shown on the yearly card is 95.88 / 12 = 7.99.
    pricing: { monthly: 9.99, yearlyTotal: 95.88, yearlyMonthlyEquivalent: 7.99 },
    description: 'For active creators who publish events regularly',
    storageGB: 50,
    // Marketing copy advertises "Unlimited events" on Starter; null = no cap.
    maxEvents: null,
    salesFeePercent: 4,
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
    salesFeePercent: 0,
    allowCustomBundles: true,
  },
];

/**
 * Platform commission rate per plan, as a 0–1 fraction. Single source of truth:
 * derived from each plan's `salesFeePercent` so the advertised "% sales fee" and
 * the fee actually applied in the Stripe webhook / earnings can never diverge.
 *
 * Billing v2 (T-194) lowered these from 12/8/5 to 8/4/0: with the buyer service
 * fee below covering Stripe's per-charge cost, the commission is now clean
 * margin instead of a percent that had to (and on small sales could not) absorb
 * a fixed cost. Pro at 0% means the buyer fee is the ONLY thing covering Stripe
 * on a Pro sale — which is why the fee values must be sized to the worst
 * realistic card before they're switched on.
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

/**
 * THE single calc point for the buyer service fee (billing v2, T-194/T-195).
 *
 * `fee = BUYER_SERVICE_FEE_FIXED_CENTS + round(subtotalCents × BPS / 10000)`
 *
 * Charged to the buyer on top of the cart subtotal, as its own visible Stripe
 * line item. No checkout, cart, or earnings path may re-derive it inline — both
 * the charged amount and the displayed amount must come from here, or they can
 * diverge (and a receipt that disagrees with the cart is the legal risk under
 * PSD2: the flat fee itself is lawful, surprise pricing is not).
 *
 * Rounding is a single `Math.round` on the percent component, so the result is
 * always the same integer number of cents for a given subtotal.
 *
 * A non-positive subtotal yields 0: an empty or free cart produces no charge,
 * so it must not produce a lone fee line item either.
 *
 * SERVER ONLY — reads server-side env vars lazily (same pattern as
 * `getFaceSearchLimits`). `plans.ts` is imported by client components for the
 * pricing cards, so the env access lives inside the function body: importing
 * this module on the client is fine, calling this function there is not. Client
 * surfaces (the cart summary) receive a server-computed amount as a prop.
 */
export function getBuyerServiceFeeCents(subtotalCents: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  const fixed = env.BUYER_SERVICE_FEE_FIXED_CENTS;
  const bps = env.BUYER_SERVICE_FEE_BPS;
  return fixed + Math.round((subtotalCents * bps) / 10000);
}

/**
 * Minimum allowed `price_per_photo` for a PRICED event, in cents (billing v2).
 * Keeps the fixed part of the service fee from being disproportionate to the
 * item. Free events (null/0) are exempt and 0 disables the floor entirely —
 * see `isPhotoPriceAboveFloor`. Server only, for the same reason as above.
 */
export function getMinPhotoPriceCents(): number {
  return env.MIN_PHOTO_PRICE_CENTS;
}

/**
 * Whether a photo price clears the configured floor. The one predicate both
 * event-write paths (create + edit) use, so they can't drift apart.
 *
 * Free events are exempt: `null`, `undefined` and `0` all mean "not for sale"
 * and are always allowed. The floor is only a floor on a *positive* price.
 * It is enforced at write time (not as a DB constraint) so events priced below
 * a later-raised floor keep working until their price is next written.
 */
export function isPhotoPriceAboveFloor(
  pricePerPhotoCents: number | null | undefined,
  minCents: number = getMinPhotoPriceCents(),
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
