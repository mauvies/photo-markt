import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getProfileFields } from '@/database/queries';
import { env } from '@/env.mjs';
import { homeRedirectPath } from '@/lib/auth/home-redirect';
import { defaultLocale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';

const LOCALES = ['es', 'en'] as const;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ── OAuth fallback ───────────────────────────────────────────────────────
  // Supabase occasionally lands the `?code=` on the site root instead of
  // /auth/callback. Forward it to the real handler so the home page itself
  // never needs to read searchParams (which would force dynamic rendering).
  if (request.nextUrl.searchParams.has('code')) {
    const segments = pathname.split('/').filter(Boolean);
    const isHome =
      segments.length === 0 ||
      (segments.length === 1 && (LOCALES as readonly string[]).includes(segments[0]));
    if (isHome) {
      const callback = new URL('/auth/callback', request.url);
      callback.search = search;
      return NextResponse.redirect(callback);
    }
  }

  // ── Locale detection & redirect ─────────────────────────────────────────
  const firstSegment = pathname.split('/')[1];
  const hasLocale = (LOCALES as readonly string[]).includes(firstSegment);

  if (!hasLocale) {
    const acceptLang = request.headers.get('accept-language') ?? '';
    const preferred = acceptLang.toLowerCase().startsWith('es') ? 'es' : defaultLocale;
    const base = pathname === '/' ? '' : pathname;
    const target = new URL(`/${preferred}${base}${search}`, request.url);
    return NextResponse.redirect(target);
  }

  const lang = firstSegment; // 'es' | 'en'
  const isHome = pathname === `/${lang}` || pathname === `/${lang}/`;

  // ── Headers ──────────────────────────────────────────────────────────────
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-search', search);
  requestHeaders.set('x-lang', lang);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // ── Supabase session refresh ─────────────────────────────────────────────
  // Only refresh when the request actually carries a Supabase auth cookie.
  // Anonymous visitors (the common case for marketing pages) have no session
  // to refresh — skip the Supabase round-trip entirely.
  const hasSupabaseAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-'));

  if (hasSupabaseAuthCookie) {
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    // Refresh session if expired - this prevents race conditions
    // by centralizing token refresh in proxy
    // This ensures tokens are refreshed before server components/API routes access them
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Authenticated visitors to the public home go straight to their
      // dashboard, server-side — no client-side flash of the landing page.
      // Anonymous visitors keep the statically-rendered home.
      if (user && isHome) {
        const profile = await getProfileFields(supabase, user.id, ['active_role']);
        const dest = homeRedirectPath(true, profile?.active_role ?? null);
        if (dest) {
          const redirectResponse = NextResponse.redirect(
            new URL(localizedPath(lang, dest), request.url),
          );
          // Carry over any auth cookies refreshed above.
          for (const cookie of response.cookies.getAll()) {
            redirectResponse.cookies.set(cookie);
          }
          return redirectResponse;
        }
      }
    } catch (error) {
      // If it's a refresh token error, the session is invalid
      // Let individual routes handle authentication errors
      // This prevents proxy from blocking all requests
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'refresh_token_already_used'
      ) {
        // Token was already used - clear cookies to force re-auth
        response.cookies.delete('sb-access-token');
        response.cookies.delete('sb-refresh-token');
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - auth (OAuth callbacks)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - any path with a file extension (static assets)
     */
    '/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
