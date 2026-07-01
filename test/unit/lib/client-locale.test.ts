import { describe, expect, it } from 'vitest';
import { localeFromCookie, localeFromPathname } from '@/lib/i18n/client-locale';

// defaultLocale is 'es' (see src/lib/i18n/config.ts).

describe('localeFromPathname', () => {
  it('reads the locale from the first path segment', () => {
    expect(localeFromPathname('/en/dashboard/photographer/settings')).toBe('en');
    expect(localeFromPathname('/es/events/abc')).toBe('es');
  });

  it('falls back to the default locale for unknown or missing segments', () => {
    expect(localeFromPathname('/fr/events')).toBe('es');
    expect(localeFromPathname('/')).toBe('es');
    expect(localeFromPathname('')).toBe('es');
    expect(localeFromPathname(null)).toBe('es');
    expect(localeFromPathname(undefined)).toBe('es');
  });
});

describe('localeFromCookie', () => {
  it('reads the preferred-locale cookie value', () => {
    expect(localeFromCookie('preferred-locale=en')).toBe('en');
    expect(localeFromCookie('foo=1; preferred-locale=es; bar=2')).toBe('es');
  });

  it('falls back to the default locale when absent or invalid', () => {
    expect(localeFromCookie('preferred-locale=de')).toBe('es');
    expect(localeFromCookie('other=1')).toBe('es');
    expect(localeFromCookie('')).toBe('es');
    expect(localeFromCookie(null)).toBe('es');
    expect(localeFromCookie(undefined)).toBe('es');
  });
});
