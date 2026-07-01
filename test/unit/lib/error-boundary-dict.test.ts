import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * The error and not-found boundaries render entirely from the `errorPage` and
 * `notFound` blocks (read directly, since they live outside the
 * TranslationsProvider). Guard that both locales are complete, structurally
 * identical, and actually translated.
 */
describe('errorPage / notFound dictionaries', () => {
  it('expose the same keys in both locales', () => {
    expect(Object.keys(es.errorPage).sort()).toEqual(Object.keys(en.errorPage).sort());
    expect(Object.keys(es.notFound).sort()).toEqual(Object.keys(en.notFound).sort());
  });

  it('carry non-empty strings for every field in both locales', () => {
    for (const dict of [en.errorPage, es.errorPage]) {
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.description.trim().length).toBeGreaterThan(0);
      expect(dict.retry.trim().length).toBeGreaterThan(0);
    }
    for (const dict of [en.notFound, es.notFound]) {
      expect(dict.code.trim().length).toBeGreaterThan(0);
      expect(dict.title.trim().length).toBeGreaterThan(0);
      expect(dict.description.trim().length).toBeGreaterThan(0);
      expect(dict.goHome.trim().length).toBeGreaterThan(0);
    }
  });

  it('is actually translated (Spanish differs from English)', () => {
    expect(es.errorPage.title).not.toBe(en.errorPage.title);
    expect(es.errorPage.retry).not.toBe(en.errorPage.retry);
    expect(es.notFound.title).not.toBe(en.notFound.title);
    expect(es.notFound.goHome).not.toBe(en.notFound.goHome);
  });

  it('keeps the 404 code identical (not translated)', () => {
    expect(es.notFound.code).toBe(en.notFound.code);
  });
});
