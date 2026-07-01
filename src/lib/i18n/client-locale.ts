import { defaultLocale, type Locale, locales } from './config';

function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}

/**
 * Derive the active locale from a pathname's first segment (e.g. `/es/...` →
 * `es`), falling back to the default locale. Pure — used by the client error
 * and not-found boundaries, which don't receive route params.
 */
export function localeFromPathname(pathname: string | null | undefined): Locale {
  const segment = pathname?.split('/')[1];
  return isLocale(segment) ? segment : defaultLocale;
}

/**
 * Derive the locale from a `preferred-locale` cookie string, falling back to
 * the default locale. Pure (the cookie string is passed in) so it works both
 * client-side (`document.cookie`) and server-side (the request cookie header),
 * and is unit-testable. Used by the root boundaries that live outside the
 * `[lang]` i18n tree.
 */
export function localeFromCookie(cookieString: string | null | undefined): Locale {
  const match = cookieString?.match(/preferred-locale=([^;]+)/);
  const value = match?.[1];
  return isLocale(value) ? value : defaultLocale;
}
