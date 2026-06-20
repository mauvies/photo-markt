'use client';

import { useEffect, useState } from 'react';
import { WebAnalytics } from '@/components/analytics';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import {
  COOKIE_PREFERENCES_EVENT,
  type CookieConsentValue,
  readCookieConsent,
  writeCookieConsent,
} from '@/lib/cookie-consent';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

// 'pending' = haven't read localStorage yet (SSR + first client render, so the
// banner doesn't flash before we know the stored decision); 'undecided' = no
// stored choice, show the banner.
type State = CookieConsentValue | 'undecided' | 'pending';

/**
 * Owns the cookie-consent decision and gates non-essential analytics behind it:
 * Vercel analytics only mounts once consent is 'granted'. Listens for the
 * "open preferences" event (footer link) to re-show the banner after a decision.
 */
export function CookieConsent({
  dict,
  privacyHref,
}: {
  dict: Dictionary['cookieConsent'];
  privacyHref: string;
}) {
  const [state, setState] = useState<State>('pending');

  useEffect(() => {
    setState(readCookieConsent() ?? 'undecided');
    const reopen = () => setState('undecided');
    window.addEventListener(COOKIE_PREFERENCES_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, reopen);
  }, []);

  const decide = (value: CookieConsentValue) => {
    writeCookieConsent(value);
    setState(value);
  };

  return (
    <>
      {state === 'granted' && <WebAnalytics />}
      {state === 'undecided' && (
        <CookieConsentBanner
          dict={dict}
          privacyHref={privacyHref}
          onAccept={() => decide('granted')}
          onReject={() => decide('denied')}
        />
      )}
    </>
  );
}
