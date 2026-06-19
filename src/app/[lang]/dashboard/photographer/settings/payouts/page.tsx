import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { PayoutProfileSection } from '../payout-profile-section';

export default async function PhotographerSettingsPayoutsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getProfile(supabase, user.id) : null;

  return (
    <TranslationsProvider translations={dict.photographerDashboard}>
      <PayoutProfileSection profile={profile} />
    </TranslationsProvider>
  );
}
