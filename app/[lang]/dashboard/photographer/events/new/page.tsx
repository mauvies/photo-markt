import { redirect } from 'next/navigation';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getUsageStats } from '@/lib/plan-limits';
import NewEventWizard from './wizard';

export default async function NewEventPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  // At-limit redirect: server action also throws PlanLimitError, but this
  // saves the user from filling out the wizard only to be rejected at submit.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const stats = await getUsageStats(supabase, user.id);
    if (stats.eventsLimit !== null && stats.eventsCount >= stats.eventsLimit) {
      redirect(`/${lang}/dashboard/photographer/events?limit=events`);
    }
  }

  return (
    <TranslationsProvider translations={dict.newEvent}>
      <NewEventWizard shareEventLabels={dict.shareEvent} />
    </TranslationsProvider>
  );
}
