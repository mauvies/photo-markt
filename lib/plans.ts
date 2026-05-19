/**
 * Photographer subscription plans configuration
 */

export type PlanId = 'free' | 'starter' | 'pro';

/**
 * Hard ceiling on photos per single event, applied uniformly across plan
 * tiers. Enforced in the upload flow's `createPhotoUploadUrls` server
 * action; not a DB CHECK because counting 5000 rows per call would be
 * wasteful relative to the per-batch precheck we do once.
 */
export const MAX_PHOTOS_PER_EVENT = 5000;

export type PlanFeature = string | { text: string; badge?: string };

export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanPricing {
  /** Monthly recurring price (USD), shown when the user picks "monthly". */
  monthly: number;
  /** Lump-sum yearly recurring price (USD), what Stripe actually charges. */
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
  features: PlanFeature[];
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
    features: [
      'Up to 5 events',
      'Default pricing bundles only',
      'Basic search & analytics',
      '12% sales fee',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    // 20% off yearly — 14.99 * 12 = 179.88, charged as 143.88 → effectively
    // 2 months free. The per-month-equivalent shown on the yearly card is
    // 143.88 / 12 = 11.99.
    pricing: { monthly: 14.99, yearlyTotal: 143.88, yearlyMonthlyEquivalent: 11.99 },
    description: 'For active creators who publish events regularly',
    storageGB: 50,
    // Marketing copy advertises "Unlimited events" on Starter; null = no cap.
    maxEvents: null,
    salesFeePercent: 8,
    allowCustomBundles: true,
    features: [
      'Unlimited events',
      { text: 'AI-assisted talent tagging', badge: 'Coming soon' },
      'Advanced analytics',
      'Custom pricing bundles',
      'Priority in search results',
      '8% sales fee',
    ],
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
    features: [
      'Unlimited events',
      'Add +100GB for $5/mo',
      { text: 'Full AI auto-tagging', badge: 'Coming soon' },
      'Highest priority in search results',
      'Priority support',
      '5% sales fee',
    ],
  },
];

export const PLATFORM_FEE_RATES: Record<PlanId, number> = {
  free: 0.12,
  starter: 0.08,
  pro: 0.05,
};

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
  return `$${amount}/mo`;
}
