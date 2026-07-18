import { describe, expect, it } from 'vitest';
import { resolvePreferredLocale } from '@/lib/i18n/resolve-preferred-locale';

// defaultLocale is 'es' (see src/lib/i18n/config.ts).

describe('resolvePreferredLocale', () => {
  it('prefers a valid preferred-locale cookie over everything else', () => {
    expect(resolvePreferredLocale('en', 'es-ES', 'es')).toBe('en');
    expect(resolvePreferredLocale('es', 'en-US', 'es')).toBe('es');
  });

  it('falls back to accept-language when the cookie is missing or invalid', () => {
    expect(resolvePreferredLocale(undefined, 'en-US,en;q=0.9', 'es')).toBe('en');
    expect(resolvePreferredLocale(null, 'en', 'es')).toBe('en');
    expect(resolvePreferredLocale('de', 'en-GB', 'es')).toBe('en');
  });

  it('falls back to the default locale when neither cookie nor accept-language resolve to a supported locale', () => {
    // Regression: the old middleware ternary returned `defaultLocale` on both
    // branches of the accept-language check, so a Spanish-only visitor and a
    // non-English visitor were indistinguishable — this asserts English is
    // reachable and everything else lands on the default.
    expect(resolvePreferredLocale(undefined, 'es-ES,es;q=0.9', 'es')).toBe('es');
    expect(resolvePreferredLocale(undefined, 'fr-FR', 'es')).toBe('es');
    expect(resolvePreferredLocale(undefined, undefined, 'es')).toBe('es');
    expect(resolvePreferredLocale(null, null, 'es')).toBe('es');
  });
});
