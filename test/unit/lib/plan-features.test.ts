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

  it('badges the not-yet-built features as "coming soon" (BIB, outfit pattern, search priority)', () => {
    // Every badged feature uses the shared "coming soon" label.
    for (const list of [features.free, features.starter, features.pro]) {
      for (const f of list.filter((x) => x.badge)) {
        expect(f.badge).toBe(en.pricingSection.comingSoon);
      }
    }
    // BIB recognition is coming-soon on every plan.
    expect(features.free.find((f) => f.text === en.pricingSection.freeFeature4)?.badge).toBe(
      en.pricingSection.comingSoon,
    );
    // Outfit-pattern recognition (Pro) and search-result priority (Starter/Pro) too.
    expect(features.pro.find((f) => f.text === en.pricingSection.proFeature6)?.badge).toBe(
      en.pricingSection.comingSoon,
    );
    expect(features.pro.find((f) => f.text === en.pricingSection.proFeature7)?.badge).toBe(
      en.pricingSection.comingSoon,
    );
    expect(features.starter.find((f) => f.text === en.pricingSection.starterFeature7)?.badge).toBe(
      en.pricingSection.comingSoon,
    );
  });
});
