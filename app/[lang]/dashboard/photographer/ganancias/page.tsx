import { DashboardHeader } from '@/components/dashboard-header';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EarningsContent } from '../earnings/earnings-content';

export default async function GananciasPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <div>
        <DashboardHeader title={dict.photographerDashboard.earningsTitle} />
        <p className="text-sm text-muted-foreground">
          {dict.photographerDashboard.earningsSubtitle}
        </p>
      </div>
      <TranslationsProvider translations={dict.earnings}>
        <EarningsContent />
      </TranslationsProvider>
    </div>
  );
}
