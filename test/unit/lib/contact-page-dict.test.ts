import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * The public contact page renders entirely from `contactPage`. This guards that
 * both locales are complete and structurally identical — no missing sections,
 * no empty headings/bodies, every section carries a real contact email, and no
 * English leaking into Spanish.
 */
describe('contactPage dictionary', () => {
  it('exists in both locales with matching section counts', () => {
    expect(en.contactPage).toBeTruthy();
    expect(es.contactPage).toBeTruthy();
    expect(en.contactPage.sections.length).toBeGreaterThan(0);
    expect(es.contactPage.sections).toHaveLength(en.contactPage.sections.length);
  });

  it('has a non-empty heading, body and contact email for every section in both locales', () => {
    for (const dict of [en.contactPage, es.contactPage]) {
      for (const section of dict.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.body.trim().length).toBeGreaterThan(0);
        expect(section.email).toContain('@photomarkt.com');
      }
    }
  });

  it('uses the same contact emails across both locales (emails are not translated)', () => {
    expect(es.contactPage.sections.map((s) => s.email)).toEqual(
      en.contactPage.sections.map((s) => s.email),
    );
  });

  it('carries the top-level fields in both locales', () => {
    for (const dict of [en.contactPage, es.contactPage]) {
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.intro.trim().length).toBeGreaterThan(0);
      expect(dict.dashboardNote.trim().length).toBeGreaterThan(0);
    }
  });

  it('is actually translated (Spanish differs from English)', () => {
    expect(es.contactPage.intro).not.toBe(en.contactPage.intro);
    expect(es.contactPage.dashboardNote).not.toBe(en.contactPage.dashboardNote);
  });

  it('no longer falls back to the generic placeholder', () => {
    expect(en.contactPage.intro).not.toBe(en.staticPages.preparing);
    expect(es.contactPage.intro).not.toBe(es.staticPages.preparing);
  });
});
