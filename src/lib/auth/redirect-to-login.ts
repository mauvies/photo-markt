import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';
import { nextQuerySuffix, safeNext } from './safe-next';

function stripLocale(pathname: string): string {
  const segments = pathname.split('/');
  const first = segments[1];
  if (first === 'es' || first === 'en') {
    const rest = `/${segments.slice(2).join('/')}`;
    return rest === '/' ? '/' : rest.replace(/\/$/, '');
  }
  return pathname;
}

// Server-side guard helper. Redirects to the login page and captures the
// current request path (set by proxy.ts in the `x-pathname` / `x-search`
// headers) as `?next=...`. Use this in server components/layouts that need
// to gate access — never call `redirect('/login')` directly.
export async function redirectToLogin(extraQuery = ''): Promise<never> {
  const h = await headers();
  const lang = ((h.get('x-lang') as Locale | null) ?? defaultLocale) as Locale;
  const pathname = h.get('x-pathname') ?? '';
  const search = h.get('x-search') ?? '';
  const stripped = stripLocale(pathname);

  // Skip capture on auth pages — there's nothing useful to return to.
  const isAuthPath =
    stripped === '/login' ||
    stripped === '/signup' ||
    stripped.startsWith('/auth/') ||
    stripped.startsWith('/onboarding');

  const next = isAuthPath ? null : safeNext(`${stripped}${search}`);
  const nextSuffix = nextQuerySuffix(next, '?');
  const tail = extraQuery ? `${nextSuffix ? '&' : '?'}${extraQuery.replace(/^[?&]/, '')}` : '';

  return redirect(`${localizedPath(lang, '/login')}${nextSuffix}${tail}`);
}
