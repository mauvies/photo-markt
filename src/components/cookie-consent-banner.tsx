'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

/**
 * Presentational cookie-consent banner. Floats as a card above the mobile
 * bottom nav (z-50, min-h-16) via z-[70] + a bottom offset, and sits near the
 * bottom on desktop where that nav is hidden. State/persistence lives in the
 * parent <CookieConsent>. Offers three equally-reachable choices: accept all,
 * reject all, or customize (opens the per-category panel).
 */
export function CookieConsentBanner({
  dict,
  privacyHref,
  onAcceptAll,
  onRejectAll,
  onCustomize,
}: {
  dict: Dictionary['cookieConsent'];
  privacyHref: string;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onCustomize: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={dict.title}
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-3xl px-4 md:bottom-4"
    >
      <div className="rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm sm:flex sm:items-center sm:gap-4">
        <div className="flex-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{dict.title}</p>
          <p className="mt-1 leading-relaxed">
            {dict.description}{' '}
            <Link
              href={privacyHref}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {dict.privacyLink}
            </Link>
            .
          </p>
        </div>
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 sm:mt-0">
          <Button variant="ghost" size="sm" onClick={onCustomize}>
            {dict.customize}
          </Button>
          <Button variant="outline" size="sm" onClick={onRejectAll}>
            {dict.reject}
          </Button>
          <Button size="sm" onClick={onAcceptAll}>
            {dict.accept}
          </Button>
        </div>
      </div>
    </div>
  );
}
