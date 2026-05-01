'use client';

import { Globe } from 'lucide-react';
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

const labels: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
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
        <Button variant="ghost" size="icon" aria-label="Switch language">
          <Globe className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((lang) => (
          <DropdownMenuItem key={lang} asChild>
            <a
              href={buildHref(lang)}
              aria-current={lang === currentLang ? 'true' : undefined}
              className={lang === currentLang ? 'font-medium' : ''}
            >
              {labels[lang]}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageSwitcherFallback() {
  return (
    <Button variant="ghost" size="icon" aria-label="Switch language" disabled>
      <Globe className="h-5 w-5" />
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
