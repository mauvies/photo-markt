import { cookies } from 'next/headers';
import Link from 'next/link';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';
import { localeFromCookie } from '@/lib/i18n/client-locale';

const DICTS = { en, es };

export default async function NotFound() {
  // The root not-found lives outside the `[lang]` tree (paths the middleware
  // didn't rewrite to a locale). Detect the locale from the `preferred-locale`
  // cookie so it's translated too, falling back to the default.
  const value = (await cookies()).get('preferred-locale')?.value;
  const t = DICTS[localeFromCookie(value ? `preferred-locale=${value}` : undefined)].notFound;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
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
