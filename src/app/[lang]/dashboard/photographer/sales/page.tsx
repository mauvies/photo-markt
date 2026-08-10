import { DashboardHeader } from '@/components/dashboard-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { EarningsContent } from '../earnings/earnings-content';
import { PayoutsContent } from './payouts-content';
import { SalesContent } from './sales-content';

type Tab = 'sales' | 'earnings' | 'payouts';

function parseTab(value: string | string[] | undefined): Tab {
  if (value === 'earnings') return 'earnings';
  if (value === 'payouts') return 'payouts';
  return 'sales';
}

export default async function SalesEarningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ lang }, { tab }] = await Promise.all([params, searchParams]);
  const dict = await getDictionary(lang as Locale);
  const initialTab = parseTab(tab);

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <div>
        <DashboardHeader title={dict.photographerDashboard.revenueTitle} />
        <p className="text-sm text-muted-foreground">
          {dict.photographerDashboard.revenueSubtitle}
        </p>
      </div>
      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList>
          <TabsTrigger value="sales">{dict.photographerDashboard.tabSales}</TabsTrigger>
          <TabsTrigger value="earnings">{dict.photographerDashboard.tabEarnings}</TabsTrigger>
          <TabsTrigger value="payouts">{dict.photographerDashboard.tabPayouts}</TabsTrigger>
        </TabsList>
        <TabsContent value="sales" className="mt-6">
          <TranslationsProvider translations={dict.photographerDashboard}>
            <SalesContent lang={lang} />
          </TranslationsProvider>
        </TabsContent>
        <TabsContent value="earnings" className="mt-6">
          <TranslationsProvider translations={dict.earnings}>
            <EarningsContent />
          </TranslationsProvider>
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          {/* Same dictionary section as Earnings: the payout copy already lives
              there, and moving the keys would churn both files for no gain. */}
          <TranslationsProvider translations={dict.earnings}>
            <PayoutsContent />
          </TranslationsProvider>
        </TabsContent>
      </Tabs>
    </div>
  );
}
