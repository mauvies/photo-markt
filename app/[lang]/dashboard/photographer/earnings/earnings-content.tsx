'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Wallet, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { PhotographerEarning } from '@/database/queries/earnings';
import type { Payout } from '@/database/queries/payouts';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { getPayoutProfileStatusAction } from '../profile/payout-profile/actions';
import {
  createPayoutRequestAction,
  getEarningsSummaryAction,
  getPayoutsAction,
  getPhotographerEarningsAction,
} from './actions';
import { getPaymentAccountsAction } from './payment-accounts-actions';
import { PayoutProfileBanner } from './payout-profile-banner';

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
    <div className={cn('rounded-xl border bg-card p-4 sm:p-6 shadow-sm', className)}>
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

interface PayoutRequestDialogProps {
  availableBalance: number;
  onSuccess: () => void;
  isPayoutProfileComplete: boolean;
}

function PayoutRequestDialog({
  availableBalance,
  onSuccess,
  isPayoutProfileComplete,
}: PayoutRequestDialogProps) {
  const { t } = useTranslations<EarningsT>();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { data: paymentAccounts = [] } = useQuery({
    queryKey: ['payment-accounts'] as const,
    queryFn: () => getPaymentAccountsAction(),
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (paymentAccounts.length > 0 && !paymentAccountId) {
      const defaultAccount = paymentAccounts.find((a) => a.is_default);
      setPaymentAccountId(defaultAccount?.id ?? paymentAccounts[0].id);
    }
  }, [paymentAccounts, paymentAccountId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!paymentAccountId) {
      setError(t('errorSelectAccount'));
      return;
    }

    const amountCents = Math.round(Number.parseFloat(amount) * 100);

    if (!amount || Number.isNaN(amountCents) || amountCents <= 0) {
      setError(t('errorValidAmount'));
      return;
    }

    if (amountCents > availableBalance) {
      setError(`${t('errorExceedsBalance')} ${formatPrice(availableBalance)}`);
      return;
    }

    startTransition(async () => {
      try {
        await createPayoutRequestAction(amountCents, paymentAccountId);
        setOpen(false);
        setAmount('');
        setPaymentAccountId('');
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorFailedPayout'));
      }
    });
  };

  const maxAmount = (availableBalance / 100).toFixed(2);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPaymentAccountId('');
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" disabled={!isPayoutProfileComplete}>
          {t('requestPayoutButton')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('requestPayoutTitle')}</DialogTitle>
          <DialogDescription>
            {!isPayoutProfileComplete ? (
              t('completeProfileFirst')
            ) : (
              <>
                {t('enterAmountDesc')}{' '}
                <span className="font-semibold">{formatPrice(availableBalance)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {!isPayoutProfileComplete ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">{t('payoutProfileIncomplete')}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  {t('completePayoutProfileToEnable')}
                </p>
                <Link href="/dashboard/photographer/profile/payout-profile">
                  <Button variant="outline" size="sm">
                    {t('completeProfile')}
                  </Button>
                </Link>
              </div>
            ) : paymentAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">{t('noPaymentAccountsFound')}</p>
                <p className="text-xs text-muted-foreground">{t('addPaymentAccountFirst')}</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="paymentAccount">{t('paymentAccountLabel')} *</Label>
                  <Select
                    value={paymentAccountId}
                    onValueChange={setPaymentAccountId}
                    disabled={isPending}
                  >
                    <SelectTrigger id="paymentAccount">
                      <SelectValue placeholder={t('selectPaymentAccount')} />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.display_name}
                          {account.is_default && ` ${t('defaultSuffix')}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">{t('amountLabel')}</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={maxAmount}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setError(null);
                    }}
                    placeholder={`${t('maxPrefix')} ${maxAmount}`}
                    disabled={isPending}
                  />
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isPending || paymentAccounts.length === 0}>
              {isPending ? t('submitting') : t('submitRequest')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface PayoutHistoryProps {
  payouts: Payout[];
  className?: string;
}

function PayoutHistory({ payouts, className }: PayoutHistoryProps) {
  const { t } = useTranslations<EarningsT>();

  if (payouts.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{t('payoutHistoryTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('noPayoutRequestsYet')}</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-green-600 dark:text-green-400';
      case 'approved':
        return 'text-blue-600 dark:text-blue-400';
      case 'pending':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'cancelled':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className={cn('rounded-xl border bg-card p-6 shadow-sm', className)}>
      <h3 className="mb-4 text-lg font-semibold">{t('payoutHistoryTitle')}</h3>
      <div className="space-y-3">
        {payouts.map((payout) => (
          <div
            key={payout.id}
            className="flex items-center justify-between rounded-lg border bg-background p-4"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{formatPrice(payout.amount_cents)}</p>
                <span className={cn('text-xs font-medium', getStatusColor(payout.status))}>
                  {payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('requestedLabel')} {formatDateTime(payout.created_at)}
              </p>
              {payout.paid_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('paidLabel')} {formatDateTime(payout.paid_at)}
                </p>
              )}
              {payout.admin_notes && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('noteLabel')} {payout.admin_notes}
                </p>
              )}
            </div>
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
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: ['earnings'] as const,
    queryFn: async () => {
      const [summaryData, earningsData, payoutsData, profileStatus] = await Promise.all([
        getEarningsSummaryAction(),
        getPhotographerEarningsAction(20),
        getPayoutsAction(),
        getPayoutProfileStatusAction(),
      ]);
      return {
        summary: summaryData,
        earnings: earningsData,
        payouts: payoutsData,
        isPayoutProfileComplete: profileStatus.isComplete,
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  const summary = data?.summary ?? null;
  const earnings = data?.earnings ?? [];
  const payouts = data?.payouts ?? [];
  const isPayoutProfileComplete = data?.isPayoutProfileComplete ?? true;
  const isLoading = isFetching && !data;

  return (
    <div className="space-y-6">
      {/* Payout Profile Banner */}
      {!isPayoutProfileComplete && <PayoutProfileBanner isComplete={isPayoutProfileComplete} />}

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
              icon={<XCircle className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
              description={t('tenPercentFee')}
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

          {/* Payment Accounts & Requests */}
          <div className="flex flex-col gap-4 xl:flex-row">
            <div className="rounded-xl border bg-card p-6 shadow-sm xl:w-[60%]">
              <h3 className="text-lg font-semibold mb-2">{t('payoutMethodCardTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t('payoutMethodCardDesc')}</p>
              <Link href="/dashboard/photographer/profile/payout-profile">
                <Button variant="outline" size="sm">
                  {t('payoutMethodCardButton')}
                </Button>
              </Link>
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm flex-1">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t('requestPayoutTitle')}</h3>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t('requestPayoutDesc')}</p>
              <PayoutRequestDialog
                availableBalance={summary.withdrawableBalanceCents}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['earnings'] })}
                isPayoutProfileComplete={isPayoutProfileComplete}
              />
            </div>
          </div>

          {/* Earnings Table & History */}
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
