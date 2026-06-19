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

interface LanguageSwitcherProps {
  inline?: boolean;
}

function useBuildHref() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (targetLang: Locale): string => {
    const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
    const search = searchParams.toString();
    return localizedPath(targetLang, search ? `${pathWithoutLang}?${search}` : pathWithoutLang);
  };
}

function useCurrentLang(): Locale {
  const params = useParams();
  return (params?.lang as Locale) ?? 'es';
}

// Separated so the Suspense boundary is explicit on both server and client,
// preventing useSearchParams() from causing a useId() counter mismatch.
function LanguageSwitcherDropdown() {
  const currentLang = useCurrentLang();
  const buildHref = useBuildHref();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Switch language"
          className="h-10 gap-1.5 px-3 text-sm font-semibold tracking-wide uppercase"
        >
          <span aria-hidden="true" className="hidden text-xs leading-none md:inline">
            {flags[currentLang]}
          </span>
          {currentLang}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl p-1.5">
        {locales.map((lang) => {
          const isActive = lang === currentLang;
          return (
            <DropdownMenuItem key={lang} asChild>
              <a
                href={buildHref(lang)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg pr-2',
                  isActive && 'bg-accent font-medium',
                )}
              >
                <span aria-hidden="true" className="text-xs leading-none">
                  {flags[lang]}
                </span>
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

function LanguageSwitcherInline() {
  const currentLang = useCurrentLang();
  const buildHref = useBuildHref();

  return (
    <ul className="flex flex-col gap-1">
      {locales.map((lang) => {
        const isActive = lang === currentLang;
        return (
          <li key={lang}>
            <a
              href={buildHref(lang)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'border-primary bg-accent font-medium'
                  : 'border-input hover:bg-accent/50',
              )}
            >
              <span aria-hidden="true" className="text-lg leading-none">
                {flags[lang]}
              </span>
              <span>{labels[lang]}</span>
              <Check
                className={cn('ml-auto size-4', isActive ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function LanguageSwitcherFallback({ inline }: LanguageSwitcherProps) {
  if (inline) {
    return <ul className="flex flex-col gap-1" aria-busy="true" />;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Switch language"
      disabled
      className="h-10 gap-1.5 px-3 text-xs font-semibold tracking-wide uppercase"
    >
      <span aria-hidden="true" className="hidden text-sm leading-none md:inline">
        🇪🇸
      </span>
      es
    </Button>
  );
}

export function LanguageSwitcher({ inline = false }: LanguageSwitcherProps = {}) {
  return (
    <Suspense fallback={<LanguageSwitcherFallback inline={inline} />}>
      {inline ? <LanguageSwitcherInline /> : <LanguageSwitcherDropdown />}
    </Suspense>
  );
}
