import { DashboardHeader } from '@/components/dashboard-header';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { SalesContent } from '../sales/sales-content';

export default async function VentasPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  return (
    <div>
      <DashboardHeader title={dict.photographerDashboard.salesTitle} />
      <p className="text-sm text-muted-foreground">{dict.photographerDashboard.salesSubtitle}</p>
      <div className="mt-6">
        <TranslationsProvider translations={dict.photographerDashboard}>
          <SalesContent lang={lang} />
        </TranslationsProvider>
      </div>
    </div>
  );
}
