import { AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { getDashboardPath } from '@/app/[lang]/actions/roles';
import { CloseButton } from '@/components/close-button';
import { ForgotPasswordLink } from '@/components/forgot-password-link';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/database/server';
import { nextQuerySuffix, rewritePostLoginNext, safeNext } from '@/lib/auth/safe-next';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export default async function Login({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    message?: string;
    error?: string;
    plan?: string;
    period?: string;
    success?: string;
    reset?: string;
    token?: string;
    next?: string;
  }>;
}) {
  const { lang } = await routeParams;
  const dict = await getDictionary(lang as Locale);
  const params = await searchParams;
  const supabase = await createClient();
  const nextParam = safeNext(params.next);
  const period: 'monthly' | 'yearly' | null =
    params.period === 'monthly' || params.period === 'yearly' ? params.period : null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is logged in and has a plan parameter, redirect to billing checkout.
  // Forward `period` so UpgradeHandler picks the right Stripe Price.
  if (user && params.plan && (params.plan === 'starter' || params.plan === 'pro')) {
    const periodSuffix = period ? `&period=${period}` : '';
    return localizedRedirect(
      lang,
      `/dashboard/photographer/settings?upgrade=${params.plan}${periodSuffix}`,
    );
  }

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.active_role) {
      const dashboardPath = await getDashboardPath();
      return localizedRedirect(lang, dashboardPath);
    }

    const { data: roles } = await supabase
      .from('user_role_memberships')
      .select('role')
      .eq('user_id', user.id);

    if (roles && roles.length > 0) {
      const dashboardPath = await getDashboardPath();
      return localizedRedirect(lang, dashboardPath);
    }

    return localizedRedirect(lang, '/onboarding/role');
  }

  const signIn = async (formData: FormData) => {
    'use server';

    const lang = await getLangFromHeaders();
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(error);
      const errorKey = error.code === 'invalid_credentials' ? 'invalid_credentials' : 'generic';
      const safeNextParam = safeNext(params.next);
      const nextQuery = safeNextParam ? `&next=${encodeURIComponent(safeNextParam)}` : '';
      return localizedRedirect(lang, `/login?error=${errorKey}${nextQuery}`);
    }
    // After successful login, check role to decide where to send the user.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return localizedRedirect(lang, '/login?message=Could not retrieve user after login');
    }

    const { getProfileActiveRole, getUserRoles } = await import('@/database/queries');

    // Claim a guest download token if one was passed
    if (params.token) {
      try {
        const { getDownloadTokenByToken, claimDownloadToken } = await import(
          '@/database/queries/download-tokens'
        );
        const { supabaseAdmin } = await import('@/database/supabase-admin');
        const tokenRow = await getDownloadTokenByToken(supabaseAdmin, params.token);
        if (tokenRow && !tokenRow.claimed_by_user_id) {
          await claimDownloadToken(supabaseAdmin, tokenRow.id, user.id);
        }
        return localizedRedirect(lang, `/download/${params.token}?claimed=true`);
      } catch (err) {
        console.error('Failed to claim download token on login:', err);
      }
    }

    const nextPath = safeNext(params.next);
    if (nextPath) {
      // Map public-surface paths (e.g. /events/<slug>) to their authenticated
      // dashboard equivalents so users land where the in-app experience lives.
      return localizedRedirect(lang, rewritePostLoginNext(nextPath));
    }

    const activeRole = await getProfileActiveRole(supabase, user.id);
    if (activeRole) {
      const dashboardPath = await getDashboardPath();
      return localizedRedirect(lang, dashboardPath);
    }

    const roles = await getUserRoles(supabase, user.id);
    if (roles.length > 0) {
      const dashboardPath = await getDashboardPath();
      return localizedRedirect(lang, dashboardPath);
    }

    return localizedRedirect(lang, '/onboarding/role');
  };

  return (
    <TranslationsProvider translations={dict.auth}>
      <div className="relative max-w-[1300px] mx-auto flex h-full w-full flex-col items-center justify-center p-6 md:p-8">
        <CloseButton className="absolute right-4 top-4" />
        <div className="w-full max-w-md">
          <h1 className="text-center text-4xl font-bold">{dict.auth.welcomeBack}</h1>
          <p className="mt-4 text-center text-muted-foreground">{dict.auth.loginSubtitle}</p>
          <div className="mt-4">
            <GoogleSignInButton
              plan={params.plan}
              period={period ?? undefined}
              next={nextParam ?? undefined}
              label={dict.auth.continueWithGoogle}
              className="w-full h-10 border-1 rounded-full"
            />
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-2 text-sm text-muted-foreground">
                {dict.auth.orContinueWith}
              </span>
            </div>
          </div>

          <form className="animate-in flex w-full flex-col justify-center gap-2">
            {params.error && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {params.error === 'invalid_credentials'
                    ? dict.auth.errorInvalidCredentials
                    : dict.auth.errorLoginGeneric}
                </span>
              </div>
            )}
            {params?.message && (
              <div
                className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
                  params.reset === 'success'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {params.reset === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{params.message}</span>
              </div>
            )}
            <Label htmlFor="email">{dict.auth.email}</Label>
            <Input
              className="mb-4 rounded-full border bg-inherit px-4 h-10"
              id="email"
              type="email"
              name="email"
              placeholder="you@example.com"
              required
            />
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{dict.auth.password}</Label>
                <ForgotPasswordLink emailId="email" />
              </div>
              <Input
                className="mt-2 rounded-full border bg-inherit px-4 h-10 placeholder:text-muted-foreground/30"
                id="password"
                type="password"
                autoComplete="off"
                name="password"
                placeholder="••••••••"
                minLength={6}
                required
              />
            </div>
            <SubmitButton formAction={signIn} className="mb-2 h-10">
              {dict.auth.loginButton}
            </SubmitButton>
            <p className="text-center text-sm">
              {dict.auth.noAccount}{' '}
              <Link
                className="text-sky-600 hover:underline"
                href={`/signup${nextQuerySuffix(nextParam, '?')}`}
              >
                {dict.auth.signUpHere}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </TranslationsProvider>
  );
}
