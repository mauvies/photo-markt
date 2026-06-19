import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * The public terms page renders entirely from `termsOfService`. This guards
 * that both locales are complete and structurally identical — no missing
 * sections, no empty headings/bodies, and no English leaking into Spanish.
 */
describe('termsOfService dictionary', () => {
  it('exists in both locales with matching section counts', () => {
    expect(en.termsOfService).toBeTruthy();
    expect(es.termsOfService).toBeTruthy();
    expect(en.termsOfService.sections.length).toBeGreaterThan(0);
    expect(es.termsOfService.sections).toHaveLength(en.termsOfService.sections.length);
  });

  it('has a non-empty heading and body for every section in both locales', () => {
    for (const dict of [en.termsOfService, es.termsOfService]) {
      for (const section of dict.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('carries the top-level fields and a contact email in both locales', () => {
    for (const dict of [en.termsOfService, es.termsOfService]) {
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.intro.trim().length).toBeGreaterThan(0);
      expect(dict.contactEmail).toContain('@');
    }
  });

  it('is actually translated (Spanish title differs from English)', () => {
    expect(es.termsOfService.title).not.toBe(en.termsOfService.title);
    expect(es.termsOfService.intro).not.toBe(en.termsOfService.intro);
  });

  it('no longer renders the "preparing" placeholder for terms', () => {
    // The page previously showed staticPages.preparing; now it has real content.
    expect(en.termsOfService.sections.some((s) => s.body.includes('preparing'))).toBe(false);
    expect(es.termsOfService.sections.length).toBeGreaterThanOrEqual(10);
  });
});
