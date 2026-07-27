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
 *
 * Layout (T-188): a compact centered card that stacks the same way at every
 * width — text, then the button row underneath (right-aligned on desktop,
 * full-width stacked on mobile). The earlier wide side-by-side bar
 * (`sm:flex sm:items-center` + a `flex-1` text column) left the description
 * wrapping into a tall, narrow block while the short button row floated
 * mid-height beside it — an unbalanced desktop look. Stacking sidesteps the
 * text-vs-buttons width competition entirely.
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
        'fixed inset-x-0 z-[70] mx-auto max-w-lg px-4 md:bottom-4',
        hasBottomNav
          ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div className="rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm">
        <div className="text-sm text-muted-foreground">
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
            cramped wrap), a right-aligned row underneath the text on desktop
            (T-169 stacking kept; T-188 aligns the row to the end). */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
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
