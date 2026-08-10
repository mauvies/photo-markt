'use client';

import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Wallet } from 'lucide-react';
import { BundleDiscountNote } from '@/components/bundle-discount-note';
import { BuyerFeeNote } from '@/components/buyer-fee-note';
import { Skeleton } from '@/components/ui/skeleton';
import type { PhotographerEarning } from '@/database/queries/earnings';
import type { Payout } from '@/database/queries/payouts';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import {
  getConnectStatusForEarningsAction,
  getEarningsSummaryAction,
  getHasBundlePricingAction,
  getPayoutOutlookAction,
  getPayoutsAction,
  getPhotographerEarningsAction,
} from './actions';

type EarningsT = Dictionary['earnings'];

export function formatPrice(cents: number): string {
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

export function SummaryCard({ title, value, icon, description, className }: SummaryCardProps) {
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
} as const satisfies Record<Payout['status'], keyof EarningsT>;

export function PayoutHistory({ payouts, className }: PayoutHistoryProps) {
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
              <p className="font-semibold">{formatPrice(payout.amount_cents)}</p>
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

/**
 * The one revenue fetch, shared by the Earnings and Payouts tabs.
 *
 * Both tabs read the same six sources, so they share a query key: React Query
 * serves the second tab from cache instead of firing the whole set again when
 * the photographer switches.
 */
export function useRevenueData() {
  const { data, isFetching } = useQuery({
    queryKey: ['earnings'] as const,
    queryFn: async () => {
      const [summaryData, earningsData, payoutsData, connectStatus, payoutOutlook, bundlePricing] =
        await Promise.all([
          getEarningsSummaryAction(),
          getPhotographerEarningsAction(20),
          getPayoutsAction(),
          getConnectStatusForEarningsAction(),
          getPayoutOutlookAction(),
          getHasBundlePricingAction(),
        ]);
      return {
        summary: summaryData,
        earnings: earningsData,
        payouts: payoutsData,
        connectStatus: connectStatus.stripe_connect_status,
        payoutOutlook,
        hasBundlePricing: bundlePricing,
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  return {
    summary: data?.summary ?? null,
    earnings: data?.earnings ?? [],
    payouts: data?.payouts ?? [],
    // ⚠️ `null` while loading, NOT `'not_connected'`. Defaulting an unknown to
    // the alarming answer meant every visit flashed "connect your bank account to
    // start receiving payouts" at photographers whose account is perfectly
    // active, until the query resolved and it vanished. A loading state must not
    // make claims.
    connectStatus: data?.connectStatus ?? null,
    payoutOutlook: data?.payoutOutlook ?? null,
    hasBundlePricing: data?.hasBundlePricing ?? false,
    isLoading: isFetching && !data,
  };
}

export function EarningsContent() {
  const { t } = useTranslations<EarningsT>();
  const { summary, earnings, hasBundlePricing, isLoading } = useRevenueData();

  const feePercent = summary ? Math.round(summary.platformFeeRate * 100) : null;

  return (
    <div className="space-y-6">
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

          {/* The Stripe balance, the payout schedule and the payout history all
              moved to the Payouts tab: this tab answers "what did I earn", that
              one answers "when do I get it". */}
          <EarningsTable earnings={earnings} />
        </>
      ) : null}
    </div>
  );
}
