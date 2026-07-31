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
    salesFeePercent: 8,
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
 * Billing v2 (T-194/T-196) lowered these from 12/8/5: with the buyer service
 * fee covering Stripe's per-charge cost, the commission is clean margin instead
 * of a percent that had to (and on small sales could not) absorb a fixed cost.
 *
 * Pro at 0% means the buyer fee is the ONLY thing covering Stripe on a Pro sale
 * — the webhook transfers `getPhotographerNetCents(gross)` and the platform
 * absorbs Stripe's cost, so these rates and a live buyer fee must ship
 * together. That is why this change lands with the fee line item (T-196) and
 * not with the configuration (T-195).
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
 * Setting all three to 0 reproduces the pre-v2 behaviour exactly (no fee
 * charged, no fee line item, no price floor). That is the rollback: revert the
 * commit that raised them. There is no migration and no data to undo.
 *
 * ── Why these values (T-199, owner decision 2026-07-29) ──
 *
 * The shape mirrors Stripe's: a fixed part covering their fixed per-charge
 * cost, and a percent part covering their percent. Get either component wrong
 * and one end of the price range bleeds — a percent-only fee cannot cover the
 * fixed cost on a cheap photo, and a percent below Stripe's own loses MORE the
 * larger the sale.
 *
 * The binding constraint is a **Pro sale**: Pro is 0% commission, so the buyer
 * fee is the ONLY thing covering Stripe there — the platform's margin on those
 * comes from the subscription, not the sale, and the fee must merely not go
 * negative. Sized against that:
 *
 *   €1 photo   → fee €0.28, Stripe ≈ €0.27  → ≈ break-even
 *   €10 photo  → fee €0.55, Stripe ≈ €0.41  → positive
 *   €50 photo  → fee €1.75, Stripe ≈ €1.03  → positive
 *
 * The 3% was chosen over the design's provisional 1.5% precisely because 1.5%
 * sits below what an expensive (non-EEA / converted) card costs, so large sales
 * lost money. 3% covers the common cases; a card charging above 3% still leaves
 * a thin negative tail on large sales, which is accepted for now given the
 * traffic mix. Raise the bps if that tail grows.
 *
 * Stripe's own rates are not pinned here — they change, and the numbers above
 * are approximations from the owner's measurement, not a contract.
 */

/** Fixed component of the buyer service fee, in cents. 0 = disabled. */
export const BUYER_SERVICE_FEE_FIXED_CENTS = 25;

/** Percent component of the buyer service fee, in basis points. 0 = disabled. */
export const BUYER_SERVICE_FEE_BPS = 300;

/**
 * Floor on a PRICED event's `price_per_photo`, in cents, so the fixed part of
 * the fee is never disproportionate to the item. 0 = no floor.
 *
 * €1.50 is a presentation limit, not a cost one: at €0.25 + 3% a €1 photo
 * already covers its own Stripe cost. But on a €0.50 photo the fee would be
 * over half the price, which reads badly in the cart.
 */
export const MIN_PHOTO_PRICE_CENTS = 150;

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
 * Whether buyers are actually charged a service fee right now.
 *
 * Distinct from `getBuyerServiceFeeCents(x) > 0`, which needs a subtotal to ask
 * about. This answers the question the photographer-facing copy needs — "is
 * there a buyer fee at all?" — so an explanation of a fee nobody is being
 * charged is never shown while the feature is dark.
 */
export function isBuyerServiceFeeEnabled(): boolean {
  return BUYER_SERVICE_FEE_FIXED_CENTS > 0 || BUYER_SERVICE_FEE_BPS > 0;
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
 * Tier position of a plan, derived from `PLANS` order (free → starter → pro).
 *
 * Derived rather than a second hand-written table so there is one ordering to
 * keep true; `test/unit/plans.test.ts` pins free < starter < pro so reordering
 * `PLANS` for display reasons fails loudly instead of silently inverting
 * upgrade/downgrade copy. Unknown ids sort first (treated as the lowest tier).
 */
export function getPlanRank(id: PlanId): number {
  return PLANS.findIndex((plan) => plan.id === id);
}

/**
 * Is moving from `currentId` to `targetId` a move UP the tiers?
 *
 * The CTA that switches plans must not call every change an "upgrade": from
 * Pro, the only other paid plan is Starter, so the button was offering
 * "Upgrade to Starter" for what is a downgrade. Equal tiers count as false —
 * there is nothing to upgrade to.
 */
export function isPlanUpgrade(currentId: PlanId, targetId: PlanId): boolean {
  return getPlanRank(targetId) > getPlanRank(currentId);
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
