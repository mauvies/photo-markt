import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventTabForScopedSection } from '@/app/[lang]/dashboard/photographer/events/[id]/event-tab';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import type { BundleScheduleError } from '@/lib/bundle-pricing';
import { bundleScheduleErrorMessage, bundleScheduleErrorText } from '@/lib/bundle-schedule-error';

/**
 * T-213 — the ladder rejection has to arrive at the photographer as prose.
 *
 * `validateBundleSchedule` runs on the server, which has no dictionary, so the
 * reason travels as the `BUNDLE_TIERS:<code>` sentinel and each form decodes it.
 * A form that forgets shows the raw sentinel in dev and Next's redacted generic
 * error in prod — silent, since every form still "works" and nothing fails to
 * compile. That is what had happened to the create wizard, the one surface that
 * actually renders the ladder editor.
 */

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** Every client form that submits to an event write action and can be handed the sentinel. */
const FORMS = [
  'src/app/[lang]/dashboard/photographer/events/new/wizard.tsx',
  'src/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-form.tsx',
  'src/app/[lang]/dashboard/photographer/events/[id]/edit/scoped-event-edit-form.tsx',
];

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

describe('every event form decodes the BUNDLE_TIERS sentinel', () => {
  for (const path of FORMS) {
    const source = read(path);

    it(`${path} calls bundleScheduleErrorText`, () => {
      expect(source).toContain('bundleScheduleErrorText');
    });

    it(`${path} decodes before falling back to the raw error message`, () => {
      // Order matters: the generic fallback renders `error.message`, which IS
      // the sentinel. A decode placed after it is a decode that never runs.
      const decodeAt = source.indexOf('bundleScheduleErrorText');
      expect(decodeAt).toBeGreaterThan(-1);
      expect(source.indexOf('error.message', decodeAt)).toBeGreaterThan(-1);
    });
  }
});

describe('the decoded copy exists in both dictionaries', () => {
  // Codes the create wizard can realistically produce from its ladder editor.
  const CODES: BundleScheduleError[] = [
    'quantity_too_low',
    'total_not_a_discount',
    'all_photos_not_above_unit',
  ];

  for (const code of CODES) {
    it(`${code} renders localized prose, not the sentinel`, () => {
      const thrown = new Error(bundleScheduleErrorMessage(code));

      for (const [locale, dict] of [
        ['en', en],
        ['es', es],
      ] as const) {
        const templates = dict.bundlePricing.errors as Partial<
          Record<BundleScheduleError, string>
        > & { fallback: string };
        const text = bundleScheduleErrorText(thrown, {
          ...templates,
          fallback: templates.fallback,
        });
        expect(text, `${locale}/${code}`).not.toBeNull();
        expect(text).not.toContain('BUNDLE_TIERS');
        expect(text).not.toBe(templates.fallback);
      }
    });
  }
});

describe('a scoped edit save returns to the tab that shows what was edited', () => {
  it('sends a pricing save to the Pricing tab', () => {
    // Details renders no price at all, so landing there after saving a ladder
    // read as "nothing happened".
    expect(eventTabForScopedSection('pricing')).toBe('pricing');
  });

  it('keeps info and settings on the Details tab', () => {
    expect(eventTabForScopedSection('info')).toBe('details');
    expect(eventTabForScopedSection('settings')).toBe('details');
  });

  it('the scoped form derives the redirect instead of hardcoding a tab', () => {
    const source = read(
      'src/app/[lang]/dashboard/photographer/events/[id]/edit/scoped-event-edit-form.tsx',
    );
    expect(source).toContain('eventTabForScopedSection(section)');
    expect(source).not.toContain('?tab=details');
  });
});

describe('the shared price field label is localized', () => {
  const path =
    'src/app/[lang]/dashboard/photographer/events/[id]/edit/components/event-price-field.tsx';

  it('reads the label from the dictionary', () => {
    const source = read(path);
    expect(source).toContain("t('priceLabel')");
  });

  it('carries no hardcoded English label', () => {
    // Comments may still NAME the string they replaced; only code counts.
    const code = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('Price per Photo');
  });

  it('both dictionaries define the key it reads', () => {
    expect(typeof en.newEvent.priceLabel).toBe('string');
    expect(typeof es.newEvent.priceLabel).toBe('string');
    // The Spanish copy must actually be translated, not an English echo.
    expect(es.newEvent.priceLabel).not.toBe(en.newEvent.priceLabel);
  });
});
