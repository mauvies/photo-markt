import { DashboardHeader } from '@/components/dashboard-header';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { PayoutProfileForm } from './payout-profile-form';

export default async function PayoutProfilePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [supabase, dict] = await Promise.all([createClient(), getDictionary(lang as Locale)]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let existingProfile = null;
  if (user) {
    existingProfile = await getProfile(supabase, user.id);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <div>
        <DashboardHeader title={dict.payoutProfile.pageTitle} />
        <p className="text-sm text-muted-foreground">{dict.payoutProfile.pageDesc}</p>
      </div>
      <TranslationsProvider translations={dict.payoutProfile}>
        <PayoutProfileForm initialData={existingProfile} />
      </TranslationsProvider>
    </div>
  );
}
