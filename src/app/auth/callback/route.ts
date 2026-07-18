import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDashboardPath } from '@/app/[lang]/actions/roles';
import { getProfileActiveRole, getUserRoles } from '@/database/queries';
import { claimDownloadToken, getDownloadTokenByToken } from '@/database/queries/download-tokens';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { rewritePostLoginNext, safeNext } from '@/lib/auth/safe-next';
import { parsePlanIntent, planIntentResumePath } from '@/lib/billing/plan-intent';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
import { localizedPath } from '@/lib/i18n/localized-path';

export async function GET(request: Request) {
  // The `/auth/callback` route is required for the server-side auth flow implemented
  // by the SSR package. It exchanges an auth code for the user's session.
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;

  // Read locale preference set before OAuth flow
  const cookieHeader = request.headers.get('cookie') ?? '';
  const localeCookieMatch = cookieHeader.match(/preferred-locale=([^;]+)/);
  const lang: Locale = (localeCookieMatch?.[1] as Locale) ?? defaultLocale;

  if (!code) {
    return NextResponse.redirect(`${origin}${localizedPath(lang, '/login?error=missing_code')}`);
  }

  // Read OAuth state stored by signInWithGoogle before the OAuth redirect.
  // This avoids putting state in the redirectTo URL, which must exactly match
  // Supabase's configured allowed redirect URLs (query params break the match).
  let plan: string | null = null;
  let period: string | null = null;
  let downloadToken: string | null = null;
  let nextParam: string | null = null;

  const cookieStore = await cookies();
  const oauthStateCookie = cookieStore.get('oauth_redirect_state');
  if (oauthStateCookie?.value) {
    try {
      const state = JSON.parse(oauthStateCookie.value) as Record<string, string>;
      plan = state.plan ?? null;
      period = state.period ?? null;
      nextParam = state.next ?? null;
    } catch {
      // Ignore malformed cookie — fall through to query param fallback
    }
    cookieStore.delete('oauth_redirect_state');
  }

  // Fall back to query params for any non-Google flows that still pass them directly
  if (!plan) plan = requestUrl.searchParams.get('plan');
  if (!period) period = requestUrl.searchParams.get('period');
  if (!downloadToken) downloadToken = requestUrl.searchParams.get('token');
  if (!nextParam) nextParam = requestUrl.searchParams.get('next');

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

  // If the user carried a *paid* plan intent, preserve it through to checkout.
  // A brand-new user (no role yet) must complete onboarding first, with the
  // intent carried on the URL; an already-onboarded user resumes immediately.
  // Both targets are internal, whitelist-validated paths (never a raw string).
  //
  // Free intent is deliberately NOT diverted here (mirrors the `!== 'free'`
  // guard on the login/signup pages): Free needs no checkout, so it falls
  // through to the normal token-claim / `next` / role routing below — a new
  // Free user still lands in onboarding, an onboarded one on their own
  // dashboard, and a pending download token / `next` deep-link is honored.
  const planIntent = parsePlanIntent(plan, period);
  if (planIntent && planIntent.plan !== 'free') {
    const [activeRole, roles] = await Promise.all([
      getProfileActiveRole(supabase, user.id),
      getUserRoles(supabase, user.id),
    ]);
    const isOnboarded = !!activeRole || roles.length > 0;
    if (isOnboarded) {
      return NextResponse.redirect(
        `${origin}${localizedPath(lang, planIntentResumePath(planIntent))}`,
      );
    }
    const onboardingQuery = `?plan=${planIntent.plan}&period=${planIntent.period}`;
    return NextResponse.redirect(
      `${origin}${localizedPath(lang, `/onboarding/role${onboardingQuery}`)}`,
    );
  }

  if (downloadToken) {
    try {
      const tokenRow = await getDownloadTokenByToken(supabaseAdmin, downloadToken);
      if (tokenRow && !tokenRow.claimed_by_user_id) {
        await claimDownloadToken(supabaseAdmin, tokenRow.id, user.id);
      }
      return NextResponse.redirect(
        `${origin}${localizedPath(lang, `/download/${downloadToken}?claimed=true`)}`,
      );
    } catch (err) {
      console.error('Failed to claim download token:', err);
    }
  }

  const safeNextPath = safeNext(nextParam);
  if (safeNextPath) {
    // Map public-surface paths (e.g. /events/<slug>) to their authenticated
    // dashboard equivalents so users land where the in-app experience lives.
    const targetPath = rewritePostLoginNext(safeNextPath);
    return NextResponse.redirect(`${origin}${localizedPath(lang, targetPath)}`);
  }

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

  // No chosen role yet → onboarding, mirroring the login page. Sending a
  // roleless user to /dashboard previously let the dashboard mint a default
  // profile and silently skip onboarding.
  return NextResponse.redirect(`${origin}${localizedPath(lang, '/onboarding/role')}`);
}
