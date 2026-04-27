import { NextResponse } from 'next/server';
import { getDashboardPath } from '@/app/[lang]/actions/roles';
import { createClient } from '@/database/server';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';

export async function GET(request: Request) {
  // The `/auth/callback` route is required for the server-side auth flow implemented
  // by the SSR package. It exchanges an auth code for the user's session.
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const plan = requestUrl.searchParams.get('plan');
  const downloadToken = requestUrl.searchParams.get('token');
  const origin = requestUrl.origin;

  // Read locale preference set before OAuth flow
  const cookieHeader = request.headers.get('cookie') ?? '';
  const localeCookieMatch = cookieHeader.match(/preferred-locale=([^;]+)/);
  const lang: Locale = (localeCookieMatch?.[1] as Locale) ?? defaultLocale;

  if (!code) {
    return NextResponse.redirect(`${origin}${localizedPath(lang, '/login?error=missing_code')}`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('Failed to exchange code for session:', exchangeError);
    return NextResponse.redirect(`${origin}${localizedPath(lang, '/login?error=exchange_failed')}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}${localizedPath(lang, '/login?error=auth_failed')}`);
  }

  // If user has a plan parameter, redirect to billing checkout
  if (plan && (plan === 'starter' || plan === 'pro')) {
    return NextResponse.redirect(
      `${origin}${localizedPath(lang, `/dashboard/photographer/settings?upgrade=${plan}`)}`,
    );
  }

  // Claim a guest download token if one was passed from signup flow
  if (downloadToken) {
    try {
      const { getDownloadTokenByToken, claimDownloadToken } = await import(
        '@/database/queries/download-tokens'
      );
      const { supabaseAdmin } = await import('@/database/supabase-admin');

      const tokenRow = await getDownloadTokenByToken(supabaseAdmin, downloadToken);
      if (tokenRow && !tokenRow.claimed_by_user_id) {
        await claimDownloadToken(supabaseAdmin, tokenRow.id, user.id);
      }
      return NextResponse.redirect(
        `${origin}${localizedPath(lang, `/download/${downloadToken}?claimed=true`)}`,
      );
    } catch (err) {
      console.error('Failed to claim download token:', err);
      // Fall through to normal redirect
    }
  }

  const { getProfileActiveRole, getUserRoles } = await import('@/database/queries');

  const activeRole = await getProfileActiveRole(supabase, user.id);
  if (activeRole) {
    const dashboardPath = await getDashboardPath();
    return NextResponse.redirect(`${origin}${localizedPath(lang, dashboardPath)}`);
  }

  const roles = await getUserRoles(supabase, user.id);
  if (roles.length > 0) {
    const dashboardPath = await getDashboardPath();
    return NextResponse.redirect(`${origin}${localizedPath(lang, dashboardPath)}`);
  }

  return NextResponse.redirect(`${origin}${localizedPath(lang, '/dashboard')}`);
}
