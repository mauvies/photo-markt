import type { Dictionary } from '@/lib/i18n/get-dictionary';
import type { PlanId } from '@/lib/plans';

export type PlanFeatureItem = { text: string; bold?: boolean; badge?: string };

/**
 * Per-plan feature lists, sourced from the `pricingSection` dictionary so the
 * landing pricing cards and the billing settings page render the exact same,
 * translated list — single source of truth, no divergence. The first feature
 * of each plan is bold (the headline); the "outfit pattern" Pro feature carries
 * the "coming soon" badge, mirroring the landing.
 */
export function getPlanFeatures(
  t: Dictionary['pricingSection'],
): Record<PlanId, PlanFeatureItem[]> {
  return {
    free: [
      { text: t.freeFeature1, bold: true },
      { text: t.freeFeature2 },
      { text: t.freeFeature3 },
      { text: t.freeFeature4 },
      { text: t.freeFeature5 },
      { text: t.freeFeature6 },
    ],
    starter: [
      { text: t.starterFeature1, bold: true },
      { text: t.starterFeature2 },
      { text: t.starterFeature3 },
      { text: t.starterFeature4 },
      { text: t.starterFeature5 },
      { text: t.starterFeature6 },
      { text: t.starterFeature7 },
    ],
    pro: [
      { text: t.proFeature1, bold: true },
      { text: t.proFeature2 },
      { text: t.proFeature3 },
      { text: t.proFeature4 },
      { text: t.proFeature5 },
      { text: t.proFeature6, badge: t.comingSoon },
      { text: t.proFeature7 },
    ],
  };
}
