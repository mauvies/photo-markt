/**
 * Photographer subscription plans configuration
 */

export type PlanId = 'free' | 'starter' | 'pro';

export type PlanFeature = string | { text: string; badge?: string };

export interface Plan {
  id: PlanId;
  name: string;
  price: number | null; // null for free plan
  priceInterval: 'month' | 'year' | null;
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
    price: 0,
    priceInterval: null,
    description: 'Perfect for getting started and testing Photo Markt',
    storageGB: 1,
    maxEvents: 3,
    salesFeePercent: 15,
    allowCustomBundles: false,
    features: [
      '1GB storage',
      'Up to 3 events',
      'Default pricing bundles only',
      'Basic search & analytics',
      '15% sales fee',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 14.99,
    priceInterval: 'month',
    description: 'For active creators who publish events regularly',
    storageGB: 50,
    maxEvents: 200,
    salesFeePercent: 8,
    allowCustomBundles: true,
    features: [
      '50GB storage',
      'Up to 200 events',
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
    price: 29.99,
    priceInterval: 'month',
    description: 'For professional photographers and studios',
    storageGB: 200,
    maxEvents: null, // Unlimited
    salesFeePercent: 5,
    allowCustomBundles: true,
    features: [
      '200GB storage included',
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
  free: 0.15,
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

export function formatPlanPrice(plan: Plan): string {
  if (plan.price === null) {
    return 'Free';
  }
  return `$${plan.price}/${plan.priceInterval === 'month' ? 'mo' : 'yr'}`;
}
