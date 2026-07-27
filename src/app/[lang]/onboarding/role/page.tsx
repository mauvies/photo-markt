import { completeOnboarding, getDashboardPath } from '@/app/[lang]/actions/roles';
import OnboardingRoleForm from '@/components/onboarding-role-form';
import { createClient } from '@/database/server';
import { redirectToLogin } from '@/lib/auth/redirect-to-login';
import { parsePlanIntent } from '@/lib/billing/plan-intent';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';
import { type RoleSlug, roleSlugToEnum } from '@/lib/roles';
import { isValidUsername, normalizeUsername } from '@/lib/username';

/** Map a redirect `message` code to a localized error string for the form. */
function errorForMessage(
  message: string | undefined,
  dict: Awaited<ReturnType<typeof getDictionary>>['onboarding'],
): string | undefined {
  switch (message) {
    case 'invalid_role':
      return dict.roleRequired;
    case 'username_invalid':
      return dict.usernameInvalid;
    case 'username_taken':
      return dict.usernameTaken;
    default:
      return undefined;
  }
}

export default async function OnboardingRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ message?: string; plan?: string; period?: string }>;
}) {
  const { lang } = await params;
  const { message, plan, period } = await searchParams;
  // A plan chosen before signup rides through onboarding on the URL. Validate
  // it server-side here; it resumes into checkout after the role is assigned.
  const planIntent = parsePlanIntent(plan, period);
  const dict = await getDictionary(lang as Locale);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectToLogin();
  }

  const { getUserRole, getSuggestedUsername } = await import('@/database/queries');

  // Gate on a *held* role (capability), not `active_role`. A user whose
  // `active_role` is set but who holds no role (e.g. a partial onboarding
  // write) must stay here to (re)complete onboarding — redirecting them to a
  // dashboard would bounce back through `/dashboard` forever (T-061 loop).
  const existingRole = await getUserRole(supabase, user.id);

  if (existingRole) {
    const dashboardPath = await getDashboardPath();
    return localizedRedirect(lang, dashboardPath);
  }

  const saveRole = async (formData: FormData) => {
    'use server';

    const lang = await getLangFromHeaders();
    const role = (formData.get('role') as string | null)?.toLowerCase() as RoleSlug | null;
    if (role !== 'photographer' && role !== 'talent') {
      return localizedRedirect(lang, '/onboarding/role?message=invalid_role');
    }

    const username = normalizeUsername((formData.get('username') as string | null) ?? '');
    if (!isValidUsername(username)) {
      return localizedRedirect(lang, '/onboarding/role?message=username_invalid');
    }

    const result = await completeOnboarding(
      roleSlugToEnum(role),
      username,
      planIntent ?? undefined,
    );
    // On success `completeOnboarding` redirects (throws NEXT_REDIRECT) and never
    // returns. A returned result is a recoverable failure to surface on the page.
    if (result?.error) {
      return localizedRedirect(lang, `/onboarding/role?message=${result.error}`);
    }
  };

  // Pre-fill the username field with a valid, available suggestion (display
  // name → email fallback) so the user can continue without typing.
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  const suggestedUsername = await getSuggestedUsername(supabase, {
    fullName,
    email: user.email,
  });

  return (
    <div className="mx-auto w-full max-w-[1300px] px-3 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold">{dict.onboarding.roleTitle}</h1>
        <p className="mt-2 text-muted-foreground">{dict.onboarding.roleSubtitle}</p>
      </div>
      <OnboardingRoleForm
        saveRole={saveRole}
        dict={dict.onboarding}
        errorMessage={errorForMessage(message, dict.onboarding)}
        suggestedUsername={suggestedUsername}
      />
    </div>
  );
}
