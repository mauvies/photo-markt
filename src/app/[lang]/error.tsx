'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { localeFromPathname } from '@/lib/i18n/client-locale';

const DICTS = { en, es };

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Error boundaries don't receive route params, so derive the locale from the
  // pathname (`/es/...` | `/en/...`). This subtree renders outside the
  // TranslationsProvider, so we read the dictionary directly.
  const t = DICTS[localeFromPathname(usePathname())].errorPage;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
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
  );
}
