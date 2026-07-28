import { Camera, DollarSign, ShoppingBag } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import { Card, CardContent } from '@/components/ui/card';
import { PLATFORM_CURRENCY } from '@/lib/currency';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { getTalentOrderStats, getTalentOrders } from './actions';
import { OrdersList } from './orders-list';

function formatCurrency(cents: number, currency = PLATFORM_CURRENCY): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
        {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function TalentOrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const [orders, stats] = await Promise.all([getTalentOrders(), getTalentOrderStats()]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DashboardHeader title={dict.talentDashboard.orders} />

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          icon={ShoppingBag}
          label={dict.talentDashboard.totalOrders}
          value={stats.totalOrders}
          helper={`${stats.completedOrders} ${dict.talentDashboard.completedOrders}`}
        />
        <StatCard
          icon={Camera}
          label={dict.talentDashboard.photosPurchased}
          value={stats.totalPurchasedPhotos}
          helper={dict.talentDashboard.acrossAllOrders}
        />
        <StatCard
          icon={DollarSign}
          label={dict.talentDashboard.totalSpent}
          value={formatCurrency(stats.totalSpentCents)}
          helper={dict.talentDashboard.lifetimeTotal}
        />
      </div>

      <TranslationsProvider translations={dict.ordersList}>
        <OrdersList orders={orders} />
      </TranslationsProvider>
    </div>
  );
}
