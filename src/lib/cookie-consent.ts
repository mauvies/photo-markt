// Cookie-consent state, persisted in localStorage. No CMP library — a small
// per-category model that gates non-essential cookies. Today the only
// non-essential category is analytics (Vercel Web Analytics / Speed Insights);
// the shape is an object so new categories (e.g. marketing) can be added without
// reworking storage. Essential cookies (auth/session) and error monitoring
// (Sentry, legitimate interest) are always on and are not represented here.

export const COOKIE_CONSENT_STORAGE_KEY = 'photo-markt_cookie_consent';

// Dispatched by the footer "Cookie preferences" trigger to re-open the panel
// after a decision has already been made.
export const COOKIE_PREFERENCES_EVENT = 'photo-markt:open-cookie-preferences';

/**
 * Non-essential cookie categories the user can toggle. 'necessary' is always on
 * and intentionally NOT part of this type — there is nothing to consent to.
 */
export type CookieCategory = 'analytics';

export type CookieConsent = Record<CookieCategory, boolean>;

export const ALL_CATEGORIES: CookieCategory[] = ['analytics'];

export function acceptAllConsent(): CookieConsent {
  return { analytics: true };
}

export function rejectAllConsent(): CookieConsent {
  return { analytics: false };
}

function normalize(value: unknown): CookieConsent | null {
  if (!value || typeof value !== 'object') return null;
  const analytics = (value as Record<string, unknown>).analytics;
  return typeof analytics === 'boolean' ? { analytics } : null;
}

/**
 * Returns the stored per-category consent, or null when the user hasn't decided
 * yet (so the banner should show). Transparently migrates the legacy binary
 * values written by T-024 (`'granted'` / `'denied'`) so existing users keep
 * their prior choice without seeing the banner again.
 */
export function readCookieConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!stored) return null;
    if (stored === 'granted') return acceptAllConsent();
    if (stored === 'denied') return rejectAllConsent();
    return normalize(JSON.parse(stored));
  } catch {
    // localStorage blocked or malformed JSON — treat as undecided.
    return null;
  }
}

export function writeCookieConsent(consent: CookieConsent): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Persisting failed (quota / blocked storage) — the in-memory decision still
    // applies for this session; nothing else to do.
  }
}

export function openCookiePreferences(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COOKIE_PREFERENCES_EVENT));
}
