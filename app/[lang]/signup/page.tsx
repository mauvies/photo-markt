import Link from 'next/link';
import { getDashboardPath } from '@/app/[lang]/actions/roles';
import { CloseButton } from '@/components/close-button';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/database/server';
import { nextQuerySuffix, safeNext } from '@/lib/auth/safe-next';
import { getSiteUrl } from '@/lib/get-site-url';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedPath } from '@/lib/i18n/localized-path';
import { localizedRedirect } from '@/lib/i18n/redirect';

export default async function Signup({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ message?: string; plan?: string; token?: string; next?: string }>;
}) {
  const { lang } = await routeParams;
  const dict = await getDictionary(lang as Locale);
  const params = await searchParams;
  const supabase = await createClient();
  const nextParam = safeNext(params.next);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is logged in and has a plan parameter, redirect to settings page
  if (user && params.plan && (params.plan === 'starter' || params.plan === 'pro')) {
    return localizedRedirect(lang, `/dashboard/photographer/settings?upgrade=${params.plan}`);
  }

  if (user) {
    const dashboardPath = await getDashboardPath();
    return localizedRedirect(lang, dashboardPath);
  }

  const signUp = async (formData: FormData) => {
    'use server';

    const lang = await getLangFromHeaders();
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (password !== confirmPassword) {
      return localizedRedirect(lang, '/signup?message=Passwords do not match');
    }

    const supabase = await createClient();

    const baseRedirect = getSiteUrl();
    const callbackQuery: string[] = [];
    if (params.token) callbackQuery.push(`token=${encodeURIComponent(params.token)}`);
    if (nextParam) callbackQuery.push(`next=${encodeURIComponent(nextParam)}`);
    const tokenRedirect = callbackQuery.length
      ? `${baseRedirect}/auth/callback?${callbackQuery.join('&')}`
      : baseRedirect;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: tokenRedirect,
      },
    });

    if (error) {
      console.error(error);
      const nextSuffix = nextQuerySuffix(nextParam, '&');
      return localizedRedirect(
        lang,
        `/signup?message=Could not signup user. Reason: ${error.code}${nextSuffix}`,
      );
    }

    // Preserve plan, token, and next parameters if present
    const planParam = params.plan ? `&plan=${params.plan}` : '';
    const tokenParam = params.token ? `&token=${params.token}` : '';
    const nextSuffix = nextQuerySuffix(nextParam, '&');
    return localizedRedirect(
      lang,
      `/login?success=Check email to continue sign in process${planParam}${tokenParam}${nextSuffix}`,
    );
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center p-6 md:p-8">
      <CloseButton className="absolute right-4 top-4 md:right-6 md:top-6" />
      <div className="w-full max-w-md">
        <h1 className="text-center text-4xl font-bold">{dict.signup.title}</h1>
        <p className="mt-4 text-center text-muted-foreground">{dict.signup.subtitle}</p>

        <div className="mt-4">
          <GoogleSignInButton
            plan={params.plan}
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
              {dict.signup.orContinueWithEmail}
            </span>
          </div>
        </div>

        <form className="animate-in flex w-full flex-col justify-center gap-2">
          {params?.message && (
            <p className="mt-4 border border-red-500 bg-red-100 p-4 text-center text-slate-600">
              {params.message}
            </p>
          )}
          <Label htmlFor="email">{dict.signup.email}</Label>
          <Input
            className="mb-4 rounded-full border bg-inherit px-4 h-10"
            id="email"
            type="email"
            name="email"
            placeholder="you@example.com"
            required
          />
          <Label htmlFor="password">{dict.signup.password}</Label>
          <Input
            className="mb-4 rounded-full border bg-inherit px-4 h-10 placeholder:text-muted-foreground/30"
            id="password"
            type="password"
            autoComplete="off"
            name="password"
            placeholder="••••••••"
            minLength={6}
            required
          />
          <Label htmlFor="confirmPassword">{dict.signup.confirmPassword}</Label>
          <Input
            className="mb-6 rounded-full border bg-inherit px-4 h-10 placeholder:text-muted-foreground/30"
            id="confirmPassword"
            type="password"
            autoComplete="off"
            name="confirmPassword"
            placeholder="••••••••"
            minLength={6}
            required
          />
          <SubmitButton formAction={signUp} className="mb-2 h-10">
            {dict.signup.createAccount}
          </SubmitButton>
          <p className="text-center text-muted-foreground">
            {dict.signup.alreadyHaveAccount}{' '}
            <Link
              className="text-sky-600 hover:underline"
              href={localizedPath(lang, `/login${nextQuerySuffix(nextParam, '?')}`)}
            >
              {dict.signup.loginHere}{' '}
            </Link>
            {dict.signup.here}
          </p>
          <p className="mt-4 text-center text-xs">{dict.signup.termsNotice}</p>
        </form>
      </div>
    </div>
  );
}
