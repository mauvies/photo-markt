import { headers } from 'next/headers';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';
import { nextQuerySuffix, safeNext } from './safe-next';

// Strip the `/{locale}` prefix from a pathname so we can store the locale-free
// path as `next` and re-localize on the way back. Avoids `next=/es/...` ending
// up redirected to `/en/es/...` if the user's locale changed.
function stripLocale(pathname: string): string {
  const segments = pathname.split('/');
  const first = segments[1];
  if (first === 'es' || first === 'en') {
    const rest = `/${segments.slice(2).join('/')}`;
    return rest === '/' ? '/' : rest.replace(/\/$/, '');
  }
  return pathname;
}

// Reads the current request path (set by proxy.ts) and returns it as a
// safe `next` value. Returns null on any auth-flow page (login, signup,
// auth callback) so we never redirect a user back to /login after login.
async function currentPathAsNext(): Promise<string | null> {
  const h = await headers();
  const pathname = h.get('x-pathname') ?? '';
  const search = h.get('x-search') ?? '';
  if (!pathname) return null;

  const stripped = stripLocale(pathname);
  if (
    stripped === '/' ||
    stripped === '/login' ||
    stripped === '/signup' ||
    stripped.startsWith('/auth/') ||
    stripped.startsWith('/onboarding')
  ) {
    return null;
  }

  return safeNext(`${stripped}${search}`);
}

// Builds a localized `/login` URL that captures the current request path
// as `?next=...`. Use from server components for nav/footer/CTA links.
export async function getLoginHref(extraQuery = ''): Promise<string> {
  const lang = (((await headers()).get('x-lang') as Locale | null) ?? defaultLocale) as Locale;
  const next = await currentPathAsNext();
  const nextSuffix = nextQuerySuffix(next, '?');
  const tail = extraQuery ? `${nextSuffix ? '&' : '?'}${extraQuery.replace(/^[?&]/, '')}` : '';
  return `${localizedPath(lang, '/login')}${nextSuffix}${tail}`;
}

// Same as getLoginHref but for /signup.
export async function getSignupHref(extraQuery = ''): Promise<string> {
  const lang = (((await headers()).get('x-lang') as Locale | null) ?? defaultLocale) as Locale;
  const next = await currentPathAsNext();
  const nextSuffix = nextQuerySuffix(next, '?');
  const tail = extraQuery ? `${nextSuffix ? '&' : '?'}${extraQuery.replace(/^[?&]/, '')}` : '';
  return `${localizedPath(lang, '/signup')}${nextSuffix}${tail}`;
}
