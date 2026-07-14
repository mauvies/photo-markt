'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CartLinkButton } from '@/components/cart-link-button';
import { HeaderShell } from '@/components/header-shell';
import { LanguageSwitcher } from '@/components/language-switcher';
import { LogoLink } from '@/components/logo-link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/use-auth-user';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { useLoginHref } from '@/hooks/use-login-href';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { UserAvatar } from './user-avatar';

export function Nav() {
  const pathname = usePathname();
  const lp = useLocalizedPath();
  const buildLoginHref = useLoginHref();
  const { t } = useTranslations<Dictionary['nav']>();
  // Auth is resolved client-side so the layout around this header can be
  // statically prerendered. `user` is `undefined` until the first resolution.
  const { user } = useAuthUser();

  if (
    pathname?.includes('/signup') ||
    pathname?.includes('/login') ||
    pathname?.includes('/dashboard')
  ) {
    return null;
  }

  // Cart icon shows only on shopping surfaces — event browsing and the
  // cart/checkout pages. The landing page and photographer profiles stay
  // cart-free. Guests get the localStorage-backed guest cart variant.
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  const showCart =
    pathWithoutLang.startsWith('/events') ||
    pathWithoutLang.startsWith('/cart') ||
    pathWithoutLang.startsWith('/checkout');

  return (
    <HeaderShell>
      <LogoLink href={lp('/')} imgClassName="mt-1 h-11 w-auto" priority />

      <div className="flex items-center gap-2 md:gap-5">
        {/* Fixed-size slot regardless of `showCart` — soft navigation
              between cart and non-cart surfaces keeps this Nav instance
              mounted (see [lang]/layout.tsx), so gating the whole
              CartLinkButton on `showCart` without a reserved slot would
              still shift LanguageSwitcher/avatar on route change. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center">
          {showCart && <CartLinkButton guest={!user} />}
        </div>
        <LanguageSwitcher />
        {user === undefined ? (
          // Auth not yet resolved — reserve space, no logged-out flash.
          <Skeleton className="h-10 w-10 rounded-full" />
        ) : user ? (
          <UserAvatar user={user} />
        ) : (
          <>
            {/* Desktop only — the mobile equivalent is the full-width
                  "I'm a photographer" banner above the header (home only). */}
            <Link
              href={lp('/photographers')}
              className="hidden items-center gap-1.5 text-sm transition-colors hover:text-foreground/70 md:inline-flex"
            >
              {t('becomePhotographer')}
            </Link>
            <Link href={buildLoginHref()}>
              <Button
                size="md"
                className="bg-gradient-starter h-10 px-4 text-white transition-opacity hover:opacity-90"
              >
                {t('loginShort')}
              </Button>
            </Link>
          </>
        )}
      </div>
    </HeaderShell>
  );
}
