'use client';

import { openCookiePreferences } from '@/lib/cookie-consent';

/**
 * Footer trigger to re-open the cookie-consent banner after a decision was
 * already made. Decoupled from <CookieConsent> via a window event so the footer
 * doesn't need to share React state with it.
 */
export function CookiePreferencesButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={openCookiePreferences}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
    </button>
  );
}
