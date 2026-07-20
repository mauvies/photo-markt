'use client';

import { useEffect, useState } from 'react';
import { WebAnalytics } from '@/components/analytics';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { CookiePreferencesPanel } from '@/components/cookie-preferences-panel';
import {
  acceptAllConsent,
  COOKIE_PREFERENCES_EVENT,
  type CookieConsent as Consent,
  readCookieConsent,
  rejectAllConsent,
  writeCookieConsent,
} from '@/lib/cookie-consent';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

// 'pending' = haven't read localStorage yet (SSR + first client render, so
// nothing flashes before we know the stored decision); null = no stored choice.
type StoredConsent = Consent | null | 'pending';
// What's visible: nothing, the bottom banner, or the granular panel.
type View = 'closed' | 'banner' | 'panel';

/**
 * Owns the cookie-consent decision and gates non-essential analytics behind it
 * per category: Vercel analytics mounts only when the `analytics` category is
 * granted. Surfaces the bottom banner when undecided, and the granular panel on
 * "Customize" or when the footer fires the "open preferences" event.
 */
export function CookieConsent({
  dict,
  privacyHref,
}: {
  dict: Dictionary['cookieConsent'];
  privacyHref: string;
}) {
  const [consent, setConsent] = useState<StoredConsent>('pending');
  const [view, setView] = useState<View>('closed');

  useEffect(() => {
    const stored = readCookieConsent();
    setConsent(stored);
    if (stored === null) setView('banner');
    const openPanel = () => setView('panel');
    window.addEventListener(COOKIE_PREFERENCES_EVENT, openPanel);
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, openPanel);
  }, []);

  const commit = (next: Consent) => {
    writeCookieConsent(next);
    setConsent(next);
    setView('closed');
  };

  const analyticsGranted = consent !== 'pending' && consent !== null && consent.analytics;
  // Defaults for the panel when the user hasn't decided yet (opt-in: off).
  const panelInitial: Consent =
    consent !== 'pending' && consent !== null ? consent : rejectAllConsent();

  return (
    <>
      {analyticsGranted && <WebAnalytics />}

      {view === 'banner' && (
        <CookieConsentBanner
          dict={dict}
          privacyHref={privacyHref}
          onAcceptAll={() => commit(acceptAllConsent())}
          onRejectAll={() => commit(rejectAllConsent())}
          onCustomize={() => setView('panel')}
        />
      )}

      <CookiePreferencesPanel
        open={view === 'panel'}
        onOpenChange={(open) => {
          if (open) return;
          // Dismissing the panel (X / Esc / click-outside) while the user is
          // still undecided counts as "reject non-essential" (T-170) — persist
          // it so the banner doesn't reappear on the next navigation and
          // analytics stays off. A user who already decided (opened the panel
          // from the footer) keeps their prior choice untouched.
          if (consent === null) {
            commit(rejectAllConsent());
          } else {
            setView('closed');
          }
        }}
        dict={dict}
        initial={panelInitial}
        onSave={commit}
        onAcceptAll={() => commit(acceptAllConsent())}
        onRejectAll={() => commit(rejectAllConsent())}
      />
    </>
  );
}
