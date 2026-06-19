'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { nextQuerySuffix, safeNext } from '@/lib/auth/safe-next';
import { useLocalizedPath } from './use-localized-path';

function stripLocale(pathname: string): string {
  const segments = pathname.split('/');
  const first = segments[1];
  if (first === 'es' || first === 'en') {
    const rest = `/${segments.slice(2).join('/')}`;
    return rest === '/' ? '/' : rest.replace(/\/$/, '');
  }
  return pathname;
}

function shouldSkipCapture(stripped: string): boolean {
  return (
    stripped === '/' ||
    stripped === '/login' ||
    stripped === '/signup' ||
    stripped.startsWith('/auth/') ||
    stripped.startsWith('/onboarding')
  );
}

// Returns a function that builds a localized `/login` href containing the
// current path as `?next=...`. If currently on an auth page, omits `next`
// so the user isn't redirected back to /login after login.
export function useLoginHref() {
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const lp = useLocalizedPath();

  return useCallback(
    (extraQuery = '') => {
      const stripped = stripLocale(pathname);
      const fullSearch = search?.toString();
      const nextRaw = shouldSkipCapture(stripped)
        ? null
        : safeNext(`${stripped}${fullSearch ? `?${fullSearch}` : ''}`);
      const nextSuffix = nextQuerySuffix(nextRaw, '?');
      const tail = extraQuery ? `${nextSuffix ? '&' : '?'}${extraQuery.replace(/^[?&]/, '')}` : '';
      return `${lp('/login')}${nextSuffix}${tail}`;
    },
    [pathname, search, lp],
  );
}

// Same as useLoginHref but builds a /signup URL.
export function useSignupHref() {
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const lp = useLocalizedPath();

  return useCallback(
    (extraQuery = '') => {
      const stripped = stripLocale(pathname);
      const fullSearch = search?.toString();
      const nextRaw = shouldSkipCapture(stripped)
        ? null
        : safeNext(`${stripped}${fullSearch ? `?${fullSearch}` : ''}`);
      const nextSuffix = nextQuerySuffix(nextRaw, '?');
      const tail = extraQuery ? `${nextSuffix ? '&' : '?'}${extraQuery.replace(/^[?&]/, '')}` : '';
      return `${lp('/signup')}${nextSuffix}${tail}`;
    },
    [pathname, search, lp],
  );
}
