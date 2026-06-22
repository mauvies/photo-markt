import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { getPlanById, getPlatformFeeRate, PLATFORM_FEE_RATES, type PlanId } from '@/lib/plans';

/**
 * Guard test (T-030): the advertised pricing copy (the `pricingSection`
 * dictionary, both locales) must stay congruent with the structured business
 * config (`plans.ts`). If someone changes a plan's fee, storage, or event cap
 * in one place but not the copy, this fails.
 *
 * It only pins the dimensions the copy states as a concrete number; features
 * with no number (e.g. "Unlimited events", "Face recognition") aren't asserted.
 * The per-plan monthly AI-search quota was removed in T-036 (it advertised an
 * unenforceable number — see T-034), so it's intentionally not pinned here.
 */
const PLANS: PlanId[] = ['free', 'starter', 'pro'];

// Maps each plan to the feature keys whose copy states a structured number.
const FEE_KEY = { free: 'freeFeature1', starter: 'starterFeature1', pro: 'proFeature1' } as const;
const STORAGE_KEY = {
  free: 'freeFeature2',
  starter: 'starterFeature2',
  pro: 'proFeature2',
} as const;

describe('pricing copy ↔ config consistency', () => {
  for (const locale of ['en', 'es'] as const) {
    const dict = (locale === 'en' ? en : es).pricingSection as Record<string, string>;

    describe(`${locale} copy`, () => {
      for (const id of PLANS) {
        const plan = getPlanById(id);
        if (!plan) throw new Error(`missing plan ${id}`);

        it(`advertises the real ${id} sales fee (${plan.salesFeePercent}%)`, () => {
          expect(dict[FEE_KEY[id]]).toContain(String(plan.salesFeePercent));
        });

        it(`advertises the real ${id} storage (${plan.storageGB} GB)`, () => {
          expect(dict[STORAGE_KEY[id]]).toContain(String(plan.storageGB));
        });
      }

      it('advertises the real free event cap (5)', () => {
        expect(dict.freeFeature3).toContain(String(getPlanById('free')?.maxEvents));
      });

      it('does not promise an (unenforceable) monthly face-search number', () => {
        // T-036: face search is anonymous-friendly and the quota was never
        // enforceable per plan, so the copy must not state "N searches/month".
        expect(dict.freeFeature5).not.toMatch(/\d+\s*(searches|búsquedas)/i);
        expect(dict.freeFeature5).not.toMatch(/month|mes/i);
      });
    });
  }
});

describe('platform fee single source of truth', () => {
  it('derives PLATFORM_FEE_RATES from each plan salesFeePercent', () => {
    for (const id of PLANS) {
      const plan = getPlanById(id);
      expect(PLATFORM_FEE_RATES[id]).toBeCloseTo((plan?.salesFeePercent ?? 0) / 100, 10);
      expect(getPlatformFeeRate(id)).toBe(PLATFORM_FEE_RATES[id]);
    }
  });

  it('keeps the historical fee rates exactly (no behavior change)', () => {
    expect(PLATFORM_FEE_RATES.free).toBeCloseTo(0.12, 10);
    expect(PLATFORM_FEE_RATES.starter).toBeCloseTo(0.08, 10);
    expect(PLATFORM_FEE_RATES.pro).toBeCloseTo(0.05, 10);
  });
});
