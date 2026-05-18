'use client';

import { Check } from 'lucide-react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Locale, locales } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';
import { cn } from '@/lib/utils';

const labels: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
};

const flags: Record<Locale, string> = {
  es: '🇪🇸',
  en: '🇺🇸',
};

// Separated so the Suspense boundary is explicit on both server and client,
// preventing useSearchParams() from causing a useId() counter mismatch.
function LanguageSwitcherInner() {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentLang = (params?.lang as Locale) ?? 'es';

  function buildHref(targetLang: Locale): string {
    const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
    const search = searchParams.toString();
    return localizedPath(targetLang, search ? `${pathWithoutLang}?${search}` : pathWithoutLang);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Switch language"
          className="h-10 gap-1.5 px-3 text-xs font-semibold tracking-wide uppercase"
        >
          <span aria-hidden="true" className="hidden text-sm leading-none md:inline">
            {flags[currentLang]}
          </span>
          {currentLang}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((lang) => {
          const isActive = lang === currentLang;
          return (
            <DropdownMenuItem key={lang} asChild>
              <a
                href={buildHref(lang)}
                aria-current={isActive ? 'true' : undefined}
                className={cn('flex items-center gap-2 pr-2', isActive && 'bg-accent font-medium')}
              >
                <span aria-hidden="true">{flags[lang]}</span>
                <span>{labels[lang]}</span>
                <Check
                  className={cn('ml-auto size-4', isActive ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageSwitcherFallback() {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Switch language"
      disabled
      className="h-10 gap-1.5 px-3 text-xs font-semibold tracking-wide uppercase"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        🇪🇸
      </span>
      es
    </Button>
  );
}

export function LanguageSwitcher() {
  return (
    <Suspense fallback={<LanguageSwitcherFallback />}>
      <LanguageSwitcherInner />
    </Suspense>
  );
}
