import { getInitialVotesAction } from '@/app/[lang]/actions/feedback';
import { DashboardHeader } from '@/components/dashboard-header';
import { FeedbackView } from '@/components/feedback-view';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

export default async function PhotographerFeedbackPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const initialVotes = await getInitialVotesAction();

  return (
    <div className="flex flex-1 flex-col gap-2">
      <DashboardHeader title={dict.photographerDashboard.feedbackTitle} />
      <p className="text-sm text-muted-foreground mb-4">
        {dict.photographerDashboard.feedbackSubtitle}
      </p>
      <TranslationsProvider translations={dict.feedback}>
        <FeedbackView userRole="photographer" initialVotes={initialVotes} />
      </TranslationsProvider>
    </div>
  );
}
