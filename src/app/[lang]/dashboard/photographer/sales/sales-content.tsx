'use client';

import { useQuery } from '@tanstack/react-query';
import { DollarSign, Image, ShoppingCart, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Sale, TopSellingEvent } from '@/database/queries/sales';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { getSalesDataAction } from './actions';

type PhotographerDashboardT = Dictionary['photographerDashboard'];

function formatPrice(cents: number): string {
  return `${PLATFORM_CURRENCY_SYMBOL}${(cents / 100).toFixed(2)}`;
}

function formatDateTime(dateString: string, locale: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: string;
  className?: string;
}

function SummaryCard({ title, value, icon, trend, className }: SummaryCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-6 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
          {trend && <p className="mt-1 text-xs text-muted-foreground">{trend}</p>}
        </div>
        <div className="rounded-full bg-primary/10 p-3">{icon}</div>
      </div>
    </div>
  );
}

interface TopEventsProps {
  events: TopSellingEvent[];
}

function TopEvents({ events }: TopEventsProps) {
  const { t } = useTranslations<PhotographerDashboardT>();

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">{t('topSellingEvents')}</h3>
        <p className="text-sm text-muted-foreground">{t('noSalesYetShort')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-4 text-lg font-semibold">{t('topSellingEvents')}</h3>
      <div className="space-y-3">
        {events.map((event, index) => (
          <div
            key={event.event_id}
            className="flex items-center gap-4 rounded-lg border border-border bg-background p-3"
          >
            <div className="flex size-10 items-center justify-center rounded bg-muted text-sm font-semibold">
              #{index + 1}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{event.event_name || t('untitledEvent')}</p>
              <p className="text-xs text-muted-foreground">
                {event.photos_sold} {event.photos_sold !== 1 ? t('photos') : t('photo')} •{' '}
                {event.sales_count} {event.sales_count !== 1 ? t('sales') : t('sale')} •{' '}
                {formatPrice(event.revenue_cents)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RecentSalesProps {
  sales: Sale[];
  lang: string;
}

function RecentSales({ sales, lang }: RecentSalesProps) {
  const { t } = useTranslations<PhotographerDashboardT>();

  if (sales.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">{t('recentSales')}</h3>
        <p className="text-sm text-muted-foreground">{t('noSalesYetShort')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-4 text-lg font-semibold">{t('recentSales')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('date')}
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('event')}
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('buyer')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('amount')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('salesCommission')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('salesNetEarnings')}
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('salesStatus')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id} className="border-b border-border">
                <td className="px-4 py-3 text-sm">{formatDateTime(sale.created_at, lang)}</td>
                <td className="px-4 py-3 text-sm">{sale.event_name || t('untitledEvent')}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {sale.buyer_email || (
                    <span className="italic">
                      {t('customer')} {sale.buyer_id.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium">
                  {formatPrice(sale.unit_price_cents)}
                </td>
                <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                  {formatPrice(sale.commission_cents)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-green-600 dark:text-green-400">
                  {formatPrice(sale.net_earnings_cents)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                    {t('salesStatusCompleted')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SalesContent({ lang }: { lang: string }) {
  const { t } = useTranslations<PhotographerDashboardT>();
  const [timeRange, setTimeRange] = useState<string>('30');

  const { data: salesData, isFetching } = useQuery({
    queryKey: ['sales', { timeRange }] as const,
    queryFn: async () => {
      const endDate = new Date();
      let startDate: Date | undefined;
      if (timeRange !== 'all') {
        const days = Number.parseInt(timeRange, 10);
        startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
      }
      return getSalesDataAction(startDate?.toISOString(), endDate.toISOString());
    },
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = isFetching && !salesData;

  return (
    <div className="space-y-4">
      {/* Header with time range filter */}
      <div className="flex items-end justify-between">
        <h2 className="text-xl font-semibold">{t('overview')}</h2>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('selectTimeRange')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('last7Days')}</SelectItem>
            <SelectItem value="30">{t('last30Days')}</SelectItem>
            <SelectItem value="90">{t('last90Days')}</SelectItem>
            <SelectItem value="365">{t('lastYear')}</SelectItem>
            <SelectItem value="all">{t('allTime')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      {isLoading && !salesData ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {['revenue', 'sales', 'average', 'photos'].map((id) => (
              <Skeleton key={id} className="h-32" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
          <Skeleton className="h-96" />
        </>
      ) : salesData ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title={t('totalRevenue')}
              value={formatPrice(salesData.summary.totalRevenueCents)}
              icon={<DollarSign className="size-6 text-primary" />}
            />
            <SummaryCard
              title={t('totalSales')}
              value={salesData.summary.totalSales.toString()}
              icon={<ShoppingCart className="size-6 text-primary" />}
            />
            <SummaryCard
              title={t('averageOrderValue')}
              value={formatPrice(salesData.summary.averageOrderValueCents)}
              icon={<TrendingUp className="size-6 text-primary" />}
            />
            <SummaryCard
              title={t('photosSold')}
              value={salesData.summary.totalPhotosSold.toString()}
              icon={<Image className="size-6 text-primary" />}
            />
          </div>

          {/* Recent Sales + Top Events. The performance chart is removed
              for now — it's noisy with low data volume; bring it back when
              there's enough data to make it useful. */}
          {salesData.summary.totalSales > 0 ? (
            <>
              <RecentSales sales={salesData.recentSales} lang={lang} />
              <TopEvents events={salesData.topEvents} />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
              <ShoppingCart className="mx-auto mb-4 size-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-semibold">{t('noSalesYetShort')}</h3>
              <p className="text-sm text-muted-foreground">{t('startSellingPhotosDesc')}</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
