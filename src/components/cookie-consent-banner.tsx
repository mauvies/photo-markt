'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';

/**
 * Presentational cookie-consent banner. State/persistence lives in the parent
 * <CookieConsent>. Offers three equally-reachable choices: accept all, reject
 * all, or customize (opens the per-category panel).
 *
 * Positioning (T-169): on mobile it sits near the bottom edge, dropping only
 * far enough to clear the mobile bottom-nav (`min-h-16` ≈ 4rem, `md:hidden`)
 * WHERE that nav exists — dashboard routes. On public routes there is no
 * bottom-nav, so it sits ~1rem off the bottom. The parent passes `hasBottomNav`
 * (derived from the route). Desktop always uses `md:bottom-4` (the nav is
 * hidden there anyway).
 */
export function CookieConsentBanner({
  dict,
  privacyHref,
  hasBottomNav = false,
  onAcceptAll,
  onRejectAll,
  onCustomize,
}: {
  dict: Dictionary['cookieConsent'];
  privacyHref: string;
  /** True on routes that render the mobile bottom-nav (dashboard). */
  hasBottomNav?: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onCustomize: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={dict.title}
      className={cn(
        'fixed inset-x-0 z-[70] mx-auto max-w-3xl px-4 md:bottom-4',
        hasBottomNav
          ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]',
      )}
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
        {/* Buttons: full-width stacked on mobile (comfortable tap targets, no
            cramped wrap), a single aligned row on desktop (T-169). */}
        <div className="mt-3 flex shrink-0 flex-col gap-2 sm:mt-0 sm:flex-row sm:items-center">
          <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={onCustomize}>
            {dict.customize}
          </Button>
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onRejectAll}>
            {dict.reject}
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={onAcceptAll}>
            {dict.accept}
          </Button>
        </div>
      </div>
    </div>
  );
}
