import { SupportPage } from '@/components/support-page';
import { getSubscription } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { PLANS } from '@/lib/plans';

export default async function PhotographerSupportPage({
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

  let isPro = false;
  let planName = 'Free';

  if (user) {
    const subscription = await getSubscription(supabase, user.id);
    const isActive =
      subscription?.status && ['active', 'trialing', 'past_due'].includes(subscription.status);

    if (isActive && subscription?.plan_id) {
      const plan = PLANS.find((p) => p.id === subscription.plan_id);
      if (plan) {
        planName = plan.name;
        isPro = subscription.plan_id === 'pro';
      }
    }
  }

  return (
    <TranslationsProvider translations={dict.support}>
      <SupportPage userRole="photographer" isPro={isPro} planName={planName} />
    </TranslationsProvider>
  );
}
