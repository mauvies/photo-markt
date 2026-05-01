import { DashboardHeader } from '@/components/dashboard-header';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { PayoutProfileForm } from './payout-profile-form';

export default async function PayoutProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ connect?: string }>;
}) {
  const [{ lang }, sp] = await Promise.all([params, searchParams]);
  const connectParam = sp.connect;

  const [supabase, dict] = await Promise.all([createClient(), getDictionary(lang as Locale)]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let existingProfile = null;
  let connectStatus: 'not_connected' | 'pending' | 'active' | 'restricted' = 'not_connected';

  if (user) {
    [existingProfile] = await Promise.all([getProfile(supabase, user.id)]);
    connectStatus = (existingProfile?.stripe_connect_status ??
      'not_connected') as typeof connectStatus;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <div>
        <DashboardHeader title={dict.payoutProfile.pageTitle} />
        <p className="text-sm text-muted-foreground">{dict.payoutProfile.pageDesc}</p>
      </div>

      {connectParam === 'success' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {dict.stripeConnect.onboarding.successBanner}
          </p>
        </div>
      )}

      {connectParam === 'refresh' && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            {dict.stripeConnect.onboarding.refreshBanner}
          </p>
        </div>
      )}

      <TranslationsProvider translations={dict.payoutProfile}>
        <PayoutProfileForm
          initialData={existingProfile}
          connectStatus={connectStatus}
          lang={lang}
          stripeConnectTranslations={dict.stripeConnect}
        />
      </TranslationsProvider>
    </div>
  );
}
