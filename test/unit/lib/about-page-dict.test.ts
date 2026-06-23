import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * The public about page renders entirely from `aboutPage`. This guards that
 * both locales are complete and structurally identical — no missing sections,
 * no empty headings/bodies, and no English leaking into Spanish.
 */
describe('aboutPage dictionary', () => {
  it('exists in both locales with matching section counts', () => {
    expect(en.aboutPage).toBeTruthy();
    expect(es.aboutPage).toBeTruthy();
    expect(en.aboutPage.sections.length).toBeGreaterThan(0);
    expect(es.aboutPage.sections).toHaveLength(en.aboutPage.sections.length);
  });

  it('has a non-empty heading and body for every section in both locales', () => {
    for (const dict of [en.aboutPage, es.aboutPage]) {
      for (const section of dict.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('carries the top-level fields and a contact email in both locales', () => {
    for (const dict of [en.aboutPage, es.aboutPage]) {
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.intro.trim().length).toBeGreaterThan(0);
      expect(dict.contactBody.trim().length).toBeGreaterThan(0);
      expect(dict.contactEmail).toContain('@');
    }
  });

  it('is actually translated (Spanish differs from English)', () => {
    expect(es.aboutPage.title).not.toBe(en.aboutPage.title);
    expect(es.aboutPage.intro).not.toBe(en.aboutPage.intro);
  });

  it('no longer falls back to the generic placeholder', () => {
    expect(en.aboutPage.intro).not.toBe(en.staticPages.preparing);
    expect(es.aboutPage.intro).not.toBe(es.staticPages.preparing);
  });
});
