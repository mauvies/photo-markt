import { type Locale, locales } from './config';

function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}

/**
 * Resolve which locale an unprefixed path (e.g. `/events/abc`) should redirect
 * to. Order: `preferred-locale` cookie (if it holds a supported locale) →
 * `accept-language` header (only `en` is special-cased; anything else falls
 * through) → `defaultLocale`. Pure so the middleware's redirect decision is
 * unit-testable without mocking `NextRequest`.
 */
export function resolvePreferredLocale(
  cookieLocale: string | undefined | null,
  acceptLanguage: string | undefined | null,
  defaultLocale: Locale,
): Locale {
  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }
  if ((acceptLanguage ?? '').toLowerCase().startsWith('en')) {
    return 'en';
  }
  return defaultLocale;
}
