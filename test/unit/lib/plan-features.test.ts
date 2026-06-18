import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import { getPlanFeatures } from '@/lib/plan-features';

describe('getPlanFeatures', () => {
  const features = getPlanFeatures(en.pricingSection);

  it('builds each plan list from the pricingSection dictionary', () => {
    expect(features.free).toHaveLength(6);
    expect(features.starter).toHaveLength(7);
    expect(features.pro).toHaveLength(7);
    expect(features.free[0]).toEqual({ text: en.pricingSection.freeFeature1, bold: true });
    expect(features.pro[1]).toEqual({ text: en.pricingSection.proFeature2 });
  });

  it('marks the first feature of every plan as the bold headline', () => {
    expect(features.free[0].bold).toBe(true);
    expect(features.starter[0].bold).toBe(true);
    expect(features.pro[0].bold).toBe(true);
  });

  it('carries the "coming soon" badge on the Pro outfit-pattern feature', () => {
    const badged = features.pro.find((f) => f.badge);
    expect(badged).toEqual({
      text: en.pricingSection.proFeature6,
      badge: en.pricingSection.comingSoon,
    });
  });
});
