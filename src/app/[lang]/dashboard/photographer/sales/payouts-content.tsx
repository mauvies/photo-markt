'use client';

import { AlertTriangle, CalendarClock, Wallet } from 'lucide-react';
import Link from 'next/link';
import { StripeDashboardButton } from '@/components/stripe-dashboard-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { type MoneyTiming, resolveMoneyOnItsWay } from '@/lib/payouts/money-outlook';
import { formatPrice, PayoutHistory, useRevenueData } from '../earnings/earnings-content';

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
  const { payouts, summary, connectStatus, payoutOutlook, isLoading } = useRevenueData();

  const money = resolveMoneyOnItsWay(payoutOutlook);
  // Ledger money we could NOT send. Zero in a healthy account, so it is an
  // exception to raise rather than a figure to display.
  const unsentCents = summary?.pendingPayoutsCents ?? 0;

  /** What we can honestly say about timing — silence when Stripe said nothing. */
  function timingLabel(timing: MoneyTiming): string | null {
    if (timing.kind === 'arriving') return `${t('arrivesOn')} ${formatDay(timing.date)}`;
    if (timing.kind === 'available-on') return `${t('availableOn')} ${formatDay(timing.date)}`;
    if (timing.kind === 'ready') return t('moneyReady');
    return null;
  }

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
          {/* ONE figure and ONE date. Four balances lived here and two of them
              were not balances: "not sent yet" is an exception needing an action
              (below), and "in your bank" is not observable once the money leaves
              Stripe. What remains is a single pot — Stripe's own split between
              `pending` and `available` is settlement mechanics the photographer
              does not live in — with the date carrying the meaning.
              ⚠️ Dates are Stripe's (`available_on` / `arrival_date`), never
              derived from `delay_days`; the two disagree, and a computed date
              would look authoritative while being wrong. */}
          {money ? (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('yourMoney')}</p>
                  <p className="mt-2 text-4xl font-bold">{formatPrice(money.totalCents)}</p>
                  {timingLabel(money.timing) && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {timingLabel(money.timing)}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{t('paidAutomatically')}</p>
                </div>
                <div className="shrink-0 rounded-full bg-primary/10 p-3">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
              </div>
              {connectStatus === 'active' && (
                <StripeDashboardButton
                  label={t('stripeDashboardButton')}
                  errorNotReady={t('stripeDashboardNotReady')}
                  errorUnavailable={t('stripeDashboardUnavailable')}
                  title={t('stripeDashboardTitle')}
                  className="mt-4"
                />
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">{t('noMoneyInFlight')}</p>
            </div>
          )}

          {/* Only when it is real, and then it says what to do about it. This is
              the money T-216 records when a transfer could not be made — an
              inactive Connect account, a net below Stripe's floor, a failed
              call — so the photographer's next step is the point, not the sum. */}
          {unsentCents > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 text-sm">
                <p className="font-medium">
                  {formatPrice(unsentCents)} {t('unsentTitle')}
                </p>
                <p className="mt-0.5 text-muted-foreground">{t('unsentDesc')}</p>
                {connectStatus !== 'active' && (
                  <Link
                    href={lp('/dashboard/photographer/settings/payout-profile')}
                    className="mt-2 inline-block"
                  >
                    <Button size="sm" variant="outline">
                      {t('connectBannerButton')}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}

          <PayoutHistory payouts={payouts} />
        </>
      )}
    </div>
  );
}
