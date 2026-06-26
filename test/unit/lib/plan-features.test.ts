import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import { getPlanFeatures } from '@/lib/plan-features';

describe('getPlanFeatures', () => {
  const features = getPlanFeatures(en.pricingSection);

  it('builds each plan list from the pricingSection dictionary', () => {
    expect(features.free).toHaveLength(6);
    expect(features.starter).toHaveLength(6);
    expect(features.pro).toHaveLength(6);
    expect(features.free[0]).toEqual({ text: en.pricingSection.freeFeature1, bold: true });
    expect(features.pro[1]).toEqual({ text: en.pricingSection.proFeature2 });
  });

  it('marks the first feature of every plan as the bold headline', () => {
    expect(features.free[0].bold).toBe(true);
    expect(features.starter[0].bold).toBe(true);
    expect(features.pro[0].bold).toBe(true);
  });

  it('badges the not-yet-built features as "coming soon" (outfit pattern)', () => {
    // Every badged feature uses the shared "coming soon" label.
    for (const list of [features.free, features.starter, features.pro]) {
      for (const f of list.filter((x) => x.badge)) {
        expect(f.badge).toBe(en.pricingSection.comingSoon);
      }
    }
    // BIB recognition (`*Feature4`) shipped in T-032 — no longer coming-soon.
    expect(
      features.free.find((f) => f.text === en.pricingSection.freeFeature4)?.badge,
    ).toBeUndefined();
    expect(
      features.starter.find((f) => f.text === en.pricingSection.starterFeature4)?.badge,
    ).toBeUndefined();
    expect(
      features.pro.find((f) => f.text === en.pricingSection.proFeature4)?.badge,
    ).toBeUndefined();
    // Outfit-pattern recognition (Pro) stays coming-soon.
    expect(features.pro.find((f) => f.text === en.pricingSection.proFeature6)?.badge).toBe(
      en.pricingSection.comingSoon,
    );
  });
});
