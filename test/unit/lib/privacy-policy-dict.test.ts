import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * The public privacy policy renders entirely from `privacyPolicy`. This guards
 * that both locales are complete and structurally identical — no missing
 * sections, no empty headings/bodies, and no English leaking into Spanish.
 */
describe('privacyPolicy dictionary', () => {
  it('exists in both locales with matching section counts', () => {
    expect(en.privacyPolicy).toBeTruthy();
    expect(es.privacyPolicy).toBeTruthy();
    expect(en.privacyPolicy.sections.length).toBeGreaterThan(0);
    expect(es.privacyPolicy.sections).toHaveLength(en.privacyPolicy.sections.length);
  });

  it('has a non-empty heading and body for every section in both locales', () => {
    for (const dict of [en.privacyPolicy, es.privacyPolicy]) {
      for (const section of dict.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('carries the top-level fields and a contact email in both locales', () => {
    for (const dict of [en.privacyPolicy, es.privacyPolicy]) {
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.intro.trim().length).toBeGreaterThan(0);
      expect(dict.contactEmail).toContain('@');
    }
  });

  it('is actually translated (Spanish title differs from English)', () => {
    expect(es.privacyPolicy.title).not.toBe(en.privacyPolicy.title);
    expect(es.privacyPolicy.intro).not.toBe(en.privacyPolicy.intro);
  });
});
