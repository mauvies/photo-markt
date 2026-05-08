import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/env.mjs';
import { defaultLocale } from '@/lib/i18n/config';

const LOCALES = ['es', 'en'] as const;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
    await supabase.auth.getUser();
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
