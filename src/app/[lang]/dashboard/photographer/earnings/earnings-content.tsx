'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, DollarSign, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PhotographerEarning } from '@/database/queries/earnings';
import type { Payout } from '@/database/queries/payouts';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import {
  getConnectStatusForEarningsAction,
  getEarningsSummaryAction,
  getPayoutsAction,
  getPhotographerEarningsAction,
  getStripeConnectBalanceAction,
} from './actions';

type EarningsT = Dictionary['earnings'];

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
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
  description?: string;
  className?: string;
}

function SummaryCard({ title, value, icon, description, className }: SummaryCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold">{value}</p>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="ml-2 shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">{icon}</div>
      </div>
    </div>
  );
}

interface PayoutHistoryProps {
  payouts: Payout[];
  className?: string;
}

function PayoutHistory({ payouts, className }: PayoutHistoryProps) {
  const { t } = useTranslations<EarningsT>();

  const stripPayouts = payouts.filter((p) => p.stripe_transfer_id);

  if (stripPayouts.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{t('payoutHistoryTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('noPayoutRequestsYet')}</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border bg-card p-6 shadow-sm', className)}>
      <h3 className="mb-4 text-lg font-semibold">{t('payoutHistoryTitle')}</h3>
      <div className="space-y-3">
        {stripPayouts.map((payout) => (
          <div
            key={payout.id}
            className="flex items-center justify-between rounded-lg border bg-background p-4"
          >
            <div className="flex-1">
              <p className="font-semibold">{formatPrice(payout.amount_cents)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('paidLabel')}{' '}
                {payout.paid_at
                  ? formatDateTime(payout.paid_at)
                  : formatDateTime(payout.created_at)}
              </p>
            </div>
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Paid</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface EarningsTableProps {
  earnings: PhotographerEarning[];
  className?: string;
}

function EarningsTable({ earnings, className }: EarningsTableProps) {
  const { t } = useTranslations<EarningsT>();

  if (earnings.length === 0) {
    return (
      <div className={cn('rounded-xl border bg-card p-6 shadow-sm', className)}>
        <h3 className="mb-4 text-lg font-semibold">{t('recentEarningsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('noEarningsYet')}</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border bg-card p-6 shadow-sm', className)}>
      <h3 className="mb-4 text-lg font-semibold">{t('recentEarningsTitle')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('dateHeader')}
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('eventHeader')}
              </th>
              <th className="px-4 py-2 text-left text-sm font-medium text-muted-foreground">
                {t('buyerHeader')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('grossHeader')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('feeHeader')}
              </th>
              <th className="px-4 py-2 text-right text-sm font-medium text-muted-foreground">
                {t('netHeader')}
              </th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((earning) => (
              <tr key={earning.id} className="border-b border-border">
                <td className="px-4 py-3 text-sm">{formatDate(earning.created_at)}</td>
                <td className="px-4 py-3 text-sm">{earning.event_name || t('untitledEvent')}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {earning.buyer_email || (
                    <span className="italic">
                      {t('customerPrefix')} {earning.buyer_id.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {formatPrice(earning.gross_amount_cents)}
                </td>
                <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                  -{formatPrice(earning.platform_fee_cents)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium">
                  {formatPrice(earning.net_amount_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EarningsContent() {
  const { t } = useTranslations<EarningsT>();
  const lp = useLocalizedPath();

  const { data, isFetching } = useQuery({
    queryKey: ['earnings'] as const,
    queryFn: async () => {
      const [summaryData, earningsData, payoutsData, connectStatus, stripeBalance] =
        await Promise.all([
          getEarningsSummaryAction(),
          getPhotographerEarningsAction(20),
          getPayoutsAction(),
          getConnectStatusForEarningsAction(),
          getStripeConnectBalanceAction(),
        ]);
      return {
        summary: summaryData,
        earnings: earningsData,
        payouts: payoutsData,
        connectStatus: connectStatus.stripe_connect_status,
        stripeBalance,
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  const summary = data?.summary ?? null;
  const earnings = data?.earnings ?? [];
  const payouts = data?.payouts ?? [];
  const connectStatus = data?.connectStatus ?? 'not_connected';
  const stripeBalance = data?.stripeBalance ?? null;
  const isLoading = isFetching && !data;

  const feePercent = summary ? Math.round(summary.platformFeeRate * 100) : null;

  return (
    <div className="space-y-6">
      {/* Connect account banner if not active */}
      {connectStatus !== 'active' && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950 flex items-center justify-between gap-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            {connectStatus === 'not_connected'
              ? t('connectBannerNotConnected')
              : connectStatus === 'pending'
                ? t('connectBannerPending')
                : t('connectBannerRestricted')}
          </p>
          <Link href={lp('/dashboard/photographer/settings/payout-profile')}>
            <Button size="sm" variant="outline">
              {t('connectBannerButton')}
            </Button>
          </Link>
        </div>
      )}

      {/* Summary Cards */}
      {isLoading && !summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title={t('totalEarnings')}
              value={formatPrice(summary.totalGrossEarningsCents)}
              icon={<DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('allTimeGrossRevenue')}
            />
            <SummaryCard
              title={t('platformFees')}
              value={formatPrice(summary.platformFeeCents)}
              icon={<TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={
                feePercent !== null ? `${feePercent}% ${t('platformFeeDesc')}` : t('tenPercentFee')
              }
            />
            <SummaryCard
              title={t('netEarnings')}
              value={formatPrice(summary.totalNetEarningsCents)}
              icon={<TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('afterPlatformFees')}
            />
            <SummaryCard
              title={t('availableBalance')}
              value={formatPrice(summary.withdrawableBalanceCents)}
              icon={<Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('readyToWithdraw')}
            />
          </div>

          {/* Stripe Connect balance (live from Stripe API) */}
          {stripeBalance && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryCard
                title={t('stripeAvailable')}
                value={formatPrice(stripeBalance.available)}
                icon={<Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                description={t('stripeAvailableDesc')}
              />
              <SummaryCard
                title={t('stripePending')}
                value={formatPrice(stripeBalance.pending)}
                icon={<CalendarClock className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                description={t('stripePendingDesc')}
              />
            </div>
          )}

          {/* Payout schedule info */}
          <div className="rounded-xl border bg-card p-6 shadow-sm flex items-start gap-4">
            <CalendarClock className="h-6 w-6 text-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">{t('payoutScheduleTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('payoutScheduleDesc')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('payoutMinimumThreshold')}</p>
            </div>
          </div>

          {/* Earnings Table & Payout History */}
          <div className="flex flex-col gap-4 xl:flex-row">
            <EarningsTable earnings={earnings} className="xl:w-[60%]" />
            <div className="flex-1">
              <PayoutHistory payouts={payouts} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
