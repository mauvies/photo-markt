'use client';

import { useEffect, useState } from 'react';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { localeFromCookie } from '@/lib/i18n/client-locale';
import { defaultLocale, type Locale } from '@/lib/i18n/config';

const DICTS = { en, es };

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // GlobalError replaces the root layout, so it lives outside the `[lang]` tree
  // and the TranslationsProvider — there's no locale in the URL or params. Read
  // the `preferred-locale` cookie after mount (starting from the default keeps
  // SSR and first client render in sync, avoiding a hydration mismatch).
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  useEffect(() => {
    setLocale(localeFromCookie(document.cookie));
  }, []);

  const t = DICTS[locale].errorPage;

  return (
    <html lang={locale}>
      <body className="antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground">{t.description}</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
