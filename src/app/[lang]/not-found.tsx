'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { localeFromPathname } from '@/lib/i18n/client-locale';

const DICTS = { en, es };

export default function NotFound() {
  // not-found boundaries don't receive route params; derive the locale from the
  // pathname and read the dictionary directly (rendered outside the provider).
  const t = DICTS[localeFromPathname(usePathname())].notFound;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t.code}
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground">{t.description}</p>
      <Link
        href="/"
        className="inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t.goHome}
      </Link>
    </div>
  );
}
