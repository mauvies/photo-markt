'use client';

import { CalendarClock, Wallet } from 'lucide-react';
import Link from 'next/link';
import { StripeDashboardButton } from '@/components/stripe-dashboard-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  formatPrice,
  PayoutHistory,
  SummaryCard,
  useRevenueData,
} from '../earnings/earnings-content';

type EarningsT = Dictionary['earnings'];

/** A date Stripe gave us, in the reader's own words. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * "When do I get my money?" — the Payouts tab.
 *
 * Split out of Earnings because the two answer different questions and were
 * competing for the same screen: Earnings is the arithmetic on what sold, this
 * is the movement of the money out. It is also the natural home for the way into
 * the photographer's own Stripe account, which until now existed nowhere.
 *
 * Shares `useRevenueData` with the Earnings tab, so switching tabs re-renders
 * from cache rather than re-running six server actions.
 */
export function PayoutsContent() {
  const { t } = useTranslations<EarningsT>();
  const lp = useLocalizedPath();
  const { payouts, connectStatus, payoutOutlook, isLoading } = useRevenueData();

  return (
    <div className="space-y-6">
      {/* Only once we actually know the status — see the note in useRevenueData. */}
      {connectStatus !== null && connectStatus !== 'active' && (
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

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          {/* Live from Stripe: money already in the photographer's own account,
              as opposed to what our ledger says is owed — plus the dates, which
              are the part they actually came here for.
              ⚠️ Every date is Stripe's own (`available_on` / `arrival_date`).
              None is derived from `delay_days`: the two disagree in practice,
              and a computed date would look authoritative while being wrong. */}
          {payoutOutlook && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryCard
                title={t('stripeAvailable')}
                value={formatPrice(payoutOutlook.availableCents)}
                icon={<Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                description={
                  payoutOutlook.nextPayout
                    ? `${t('arrivesOn')} ${formatDay(payoutOutlook.nextPayout.arrivalDate)}`
                    : t('stripeAvailableDesc')
                }
              />
              <SummaryCard
                title={t('stripePending')}
                value={formatPrice(payoutOutlook.pendingCents)}
                icon={<CalendarClock className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
                description={
                  payoutOutlook.nextAvailableOn
                    ? `${t('availableOn')} ${formatDay(payoutOutlook.nextAvailableOn)}`
                    : t('stripePendingDesc')
                }
              />
            </div>
          )}

          {/* ⚠️ This block used to promise "every Monday" and a "$25 minimum".
              Neither is true: the platform sets no schedule (not in code, and not
              in the Stripe dashboard, where connected accounts are allowed to
              manage their own) and Stripe has no such minimum setting at all.
              Both numbers were invented, and were being told to the person whose
              money it is. What the photographer needs is the way IN. */}
          <div className="rounded-xl border bg-card p-6 shadow-sm flex items-start gap-4">
            <CalendarClock className="h-6 w-6 text-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">{t('payoutScheduleTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('payoutScheduleDesc')}</p>
              {connectStatus === 'active' && (
                <StripeDashboardButton
                  label={t('stripeDashboardButton')}
                  errorNotReady={t('stripeDashboardNotReady')}
                  errorUnavailable={t('stripeDashboardUnavailable')}
                  title={t('stripeDashboardTitle')}
                  className="mt-3"
                />
              )}
            </div>
          </div>

          <PayoutHistory payouts={payouts} />
        </>
      )}
    </div>
  );
}
