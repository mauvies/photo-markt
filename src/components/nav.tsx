'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CartLinkButton } from '@/components/cart-link-button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { TalentHeaderActions } from '@/components/talent-header-actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveRole } from '@/hooks/use-active-role';
import { useAuthUser } from '@/hooks/use-auth-user';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { useLoginHref, useSignupHref } from '@/hooks/use-login-href';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { UserAvatar } from './user-avatar';

/** Translations `Nav` needs beyond `dict.nav` to label `TalentHeaderActions`'
 * account dropdown — merged into one object by `[lang]/layout.tsx` so this
 * component only deals with one translations context. */
type NavT = Dictionary['nav'] & {
  activeRole: string;
  switchTo: string;
  logOut: string;
  rolePhotographer: string;
  roleTalent: string;
};

export function Nav() {
  const pathname = usePathname();
  const lp = useLocalizedPath();
  const buildLoginHref = useLoginHref();
  const buildSignupHref = useSignupHref();
  const { t } = useTranslations<NavT>();
  // Auth is resolved client-side so the layout around this header can be
  // statically prerendered. `user` is `undefined` until the first resolution.
  const { user } = useAuthUser();
  // Nav renders nothing on these routes (they have their own headers), so it
  // never reads `activeRole` there — skip the DB round-trip. Nav stays mounted
  // across client-side navigation, so without this gate every dashboard visit
  // would re-fetch a role the layout already resolved server-side.
  const hideNav = Boolean(
    pathname?.includes('/signup') ||
      pathname?.includes('/login') ||
      pathname?.includes('/dashboard'),
  );
  // T-118: gated on `!!user` so anonymous visitors never pay this round-trip.
  const { activeRole } = useActiveRole(!!user && !hideNav);

  if (hideNav) {
    return null;
  }

  // Cart icon shows only on shopping surfaces — event browsing and the
  // cart/checkout pages. The landing page and photographer profiles stay
  // cart-free. Guests get the localStorage-backed guest cart variant. This
  // only applies to the anonymous/photographer branch below — an
  // authenticated talent gets `TalentHeaderActions`, which shows the cart
  // site-wide (item-count gated, not path gated).
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  const showCart =
    pathWithoutLang.startsWith('/events') ||
    pathWithoutLang.startsWith('/cart') ||
    pathWithoutLang.startsWith('/checkout');

  const isTalentAuthenticated = Boolean(user) && activeRole === 'talent';

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-(--header-height) max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href={lp('/')} className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="Photo Markt"
            className="mt-1 h-10 w-auto"
            width={90}
            height={90}
            priority
          />
        </Link>

        {isTalentAuthenticated && user ? (
          <div className="flex items-center gap-2 md:gap-5">
            <LanguageSwitcher />
            <TalentHeaderActions
              user={{
                name: user.user_metadata?.full_name ?? user.email ?? 'Member',
                email: user.email ?? '',
                avatar: user.user_metadata?.avatar_url ?? null,
              }}
              activeRole="talent"
              labels={{
                favorites: t('favorites'),
                activeRole: t('activeRole'),
                profile: t('profile'),
                orders: t('orders'),
                privacy: t('privacy'),
                settings: t('settings'),
                support: t('support'),
                feedback: t('feedback'),
                switchTo: t('switchTo'),
                logOut: t('logOut'),
                rolePhotographer: t('rolePhotographer'),
                roleTalent: t('roleTalent'),
              }}
            />
          </div>
        ) : (
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
                <Link
                  href={buildLoginHref()}
                  className="text-sm hover:text-foreground/70 transition-colors"
                >
                  <Button size="md" className="bg-gradient-starter h-10 px-4 md:hidden">
                    {t('loginShort')}
                  </Button>
                  <span className="hidden md:inline-flex">{t('login')}</span>
                </Link>
                <Link href={buildSignupHref()} tabIndex={-1} className="hidden md:inline-flex">
                  <Button
                    size="md"
                    className="bg-gradient-starter p-5 text-white hover:opacity-90 transition-opacity"
                  >
                    {t('getStarted')}
                  </Button>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
