import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import type { BundleScheduleError } from '@/lib/bundle-pricing';
import { bundleScheduleErrorMessage, bundleScheduleErrorText } from '@/lib/bundle-schedule-error';

/**
 * T-212 — every ladder rejection must reach the photographer as prose.
 *
 * `parseBundleScheduleError` returns null for a code missing from its allow-list,
 * and the caller then falls through to `error.message`: the raw
 * `BUNDLE_TIERS:<code>` sentinel in dev, Next's redacted generic error in prod.
 * Three `all_photos_*` codes had shipped that way — with localized copy sitting
 * in both dictionaries, unreachable.
 *
 * An allow-list that has to be kept in sync by hand is exactly the thing to pin
 * with a test, so this enumerates the union and fails on the next omission.
 */

const ALL_CODES: BundleScheduleError[] = [
  'empty',
  'too_many_tiers',
  'quantity_not_integer',
  'quantity_too_low',
  'quantity_not_increasing',
  'total_not_integer',
  'total_below_floor',
  'total_not_increasing',
  'total_not_a_discount',
  'not_parseable',
  'all_photos_below_floor',
  'all_photos_not_above_unit',
  'all_photos_below_a_pack',
];

const templates = { ...en.bundlePricing.errors } as Partial<Record<BundleScheduleError, string>> & {
  fallback: string;
};

describe('every BundleScheduleError renders as localized prose', () => {
  for (const code of ALL_CODES) {
    it(`${code} resolves to copy, never the raw sentinel`, () => {
      const text = bundleScheduleErrorText(new Error(bundleScheduleErrorMessage(code)), templates);
      expect(text).not.toBeNull();
      expect(text).not.toContain('BUNDLE_TIERS:');
      expect((text ?? '').trim().length).toBeGreaterThan(0);
    });
  }

  it('carries the floor amount into the below-floor copy', () => {
    const text = bundleScheduleErrorText(
      new Error(bundleScheduleErrorMessage('total_below_floor', 150)),
      templates,
    );
    expect(text).toContain('1.50');
  });

  it('is not a ladder rejection for unrelated errors', () => {
    expect(bundleScheduleErrorText(new Error('boom'), templates)).toBeNull();
  });
});

describe('both dictionaries cover the codes they are asked to render', () => {
  for (const dict of [en, es]) {
    const errors = dict.bundlePricing.errors as Record<string, string>;
    it('has a non-empty fallback', () => {
      expect(errors.fallback?.length ?? 0).toBeGreaterThan(0);
    });
  }
});
