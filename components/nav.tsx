'use client';

import type { User } from '@supabase/supabase-js';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CartLinkButton } from '@/components/cart-link-button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { useLoginHref, useSignupHref } from '@/hooks/use-login-href';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { ROLES, type UserRole } from '@/lib/roles';
import { UserAvatar } from './user-avatar';

export function Nav({ user, activeRole }: { user: User | null; activeRole: UserRole | null }) {
  const pathname = usePathname();
  const lp = useLocalizedPath();
  const buildLoginHref = useLoginHref();
  const buildSignupHref = useSignupHref();
  const { t } = useTranslations<Dictionary['nav']>();

  if (
    pathname?.includes('/signup') ||
    pathname?.includes('/login') ||
    pathname?.includes('/dashboard')
  ) {
    return null;
  }

  // Show cart on every public page except when the user is currently acting as
  // a photographer (their dashboard hides it; the public nav matches). Guests
  // get the localStorage-backed guest cart variant.
  const showCart = activeRole !== ROLES.PHOTOGRAPHER;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-(--header-height) max-w-[1600px] items-center justify-between px-4">
        <Link href={lp('/')} className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="Photo Markt"
            className="mt-1 h-8 w-auto md:h-10"
            width={80}
            height={80}
            priority
          />
        </Link>

        <div className="flex items-center gap-2 md:gap-5">
          <div className="sm:-mr-2">
            <LanguageSwitcher />
          </div>
          {showCart && (
            <div>
              <CartLinkButton guest={!user} />
            </div>
          )}
          {user ? (
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
      </div>
    </header>
  );
}
