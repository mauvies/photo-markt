'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, DollarSign, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { BundleDiscountNote } from '@/components/bundle-discount-note';
import { BuyerFeeNote } from '@/components/buyer-fee-note';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PhotographerEarning } from '@/database/queries/earnings';
import type { Payout } from '@/database/queries/payouts';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import {
  getConnectStatusForEarningsAction,
  getEarningsSummaryAction,
  getHasBundlePricingAction,
  getPayoutsAction,
  getPhotographerEarningsAction,
  getStripeConnectBalanceAction,
} from './actions';

type EarningsT = Dictionary['earnings'];

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: PLATFORM_CURRENCY_CODE,
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

/**
 * T-216: a payout row is no longer always a completed transfer, so the status
 * has to be rendered rather than assumed. `cancelled` rows are the one thing
 * still filtered out — a voided hold (its charge was refunded) is not payout
 * history, and showing it would only prompt "where did my money go?".
 */
const PAYOUT_STATUS_LABEL_KEYS = {
  pending: 'payoutStatusPending',
  approved: 'payoutStatusPending',
  processing: 'payoutStatusProcessing',
  paid: 'payoutStatusPaid',
  cancelled: 'payoutStatusCancelled',
  reversed: 'payoutStatusReversed',
} as const satisfies Record<Payout['status'], keyof EarningsT>;

function PayoutHistory({ payouts, className }: PayoutHistoryProps) {
  const { t } = useTranslations<EarningsT>();

  // Was `payouts.filter((p) => p.stripe_transfer_id)`, which hid every row that
  // had not been transferred — i.e. exactly the outstanding amounts T-216 exists
  // to make visible.
  const stripPayouts = payouts.filter((p) => p.status !== 'cancelled');

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
              {/* Net of clawbacks (T-215): `amount_cents` is what the sale owed, and it
                    is immutable — a refunded or charged-back share lives in
                    `reversed_amount_cents`, so rendering the raw column would tell the
                    photographer they kept money that went back to the buyer. */}
              <p className="font-semibold">
                {formatPrice(payout.amount_cents - (payout.reversed_amount_cents ?? 0))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {payout.status === 'paid' ? t('paidLabel') : t('requestedLabel')}{' '}
                {payout.status === 'paid' && payout.paid_at
                  ? formatDateTime(payout.paid_at)
                  : formatDateTime(payout.created_at)}
              </p>
            </div>
            <span
              className={cn(
                'text-xs font-medium',
                payout.status === 'paid'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-muted-foreground',
              )}
            >
              {t(PAYOUT_STATUS_LABEL_KEYS[payout.status])}
            </span>
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
      const [summaryData, earningsData, payoutsData, connectStatus, stripeBalance, bundlePricing] =
        await Promise.all([
          getEarningsSummaryAction(),
          getPhotographerEarningsAction(20),
          getPayoutsAction(),
          getConnectStatusForEarningsAction(),
          getStripeConnectBalanceAction(),
          getHasBundlePricingAction(),
        ]);
      return {
        summary: summaryData,
        earnings: earningsData,
        payouts: payoutsData,
        connectStatus: connectStatus.stripe_connect_status,
        stripeBalance,
        hasBundlePricing: bundlePricing,
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  const summary = data?.summary ?? null;
  const earnings = data?.earnings ?? [];
  const payouts = data?.payouts ?? [];
  const connectStatus = data?.connectStatus ?? 'not_connected';
  const stripeBalance = data?.stripeBalance ?? null;
  const hasBundlePricing = data?.hasBundlePricing ?? false;
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
                // T-195: the fallback used to hardcode a percentage that had
                // already drifted from PLATFORM_FEE_RATES, in two directions at
                // once ("10%" in en, "12%" in es). This branch runs when the
                // rate is unknown, so it must not state a number at all.
                feePercent !== null
                  ? `${feePercent}% ${t('platformFeeDesc')}`
                  : t('platformFeeDesc')
              }
            />
            <SummaryCard
              title={t('netEarnings')}
              value={formatPrice(summary.totalNetEarningsCents)}
              icon={<TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('afterPlatformFees')}
            />
            {/* T-216: this used to be "Available balance / Ready to withdraw",
                reading `withdrawableBalanceCents`. That card was a promise the
                system could not keep: the two silent transfer exits (inactive
                Connect, sub-50-cent net) counted toward net earnings but never
                produced a payout, so the figure was permanently positive money
                that would never arrive — and there is no withdrawal UI behind
                it either. Now that every euro is paid, pending or in flight,
                that number is structurally ~0. What the photographer actually
                needs to see is what is owed but not yet sent; the genuinely
                available figure is the live Stripe balance card below, which is
                money already in their own account. */}
            <SummaryCard
              title={t('pendingPayout')}
              value={formatPrice(summary.pendingPayoutsCents)}
              icon={<Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('pendingPayoutDesc')}
            />
          </div>

          {/* T-197: the buyer service fee is platform revenue — say so, so the
              figures above aren't misread as having it taken out of them.
              Renders nothing while no buyer fee is charged.
              T-205: and a bundled sale's gross is the discounted price the
              photographer set, not a deduction — renders nothing unless they
              have volume pricing configured somewhere. */}
          <div className="space-y-1">
            <BuyerFeeNote>{t('buyerFeeNote')}</BuyerFeeNote>
            <BundleDiscountNote hasBundlePricing={hasBundlePricing}>
              {t('bundleDiscountNote')}
            </BundleDiscountNote>
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
