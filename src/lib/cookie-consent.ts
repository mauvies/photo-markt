// Lightweight cookie-consent state, persisted in localStorage. No CMP library —
// just a stored decision that gates non-essential analytics (Vercel Web
// Analytics / Speed Insights). Error monitoring (Sentry) is treated as essential
// (legitimate interest) and is not gated here.

export const COOKIE_CONSENT_STORAGE_KEY = 'photo-markt_cookie_consent';

// Dispatched by the footer "Cookie preferences" trigger to re-open the banner
// after a decision has already been made.
export const COOKIE_PREFERENCES_EVENT = 'photo-markt:open-cookie-preferences';

export type CookieConsentValue = 'granted' | 'denied';

export function readCookieConsent(): CookieConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : null;
  } catch {
    // localStorage can throw in private mode / when blocked — treat as undecided.
    return null;
  }
}

export function writeCookieConsent(value: CookieConsentValue): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, value);
  } catch {
    // Persisting failed (quota / blocked storage) — the in-memory decision still
    // applies for this session; nothing else to do.
  }
}

export function openCookiePreferences(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COOKIE_PREFERENCES_EVENT));
}
