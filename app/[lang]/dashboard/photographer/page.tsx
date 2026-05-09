import { format } from 'date-fns';
import { AlertTriangle, Calendar, DollarSign, HardDrive, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { DashboardHeader } from '@/components/dashboard-header';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { cn } from '@/lib/utils';
import { getDashboardData } from './actions';
import { QuickActions } from './quick-actions';
import { ViewEventButton } from './view-event-button';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatStorage(gb: number): string {
  if (gb < 1) {
    return `${(gb * 1024).toFixed(0)} MB`;
  }
  return `${gb.toFixed(2)} GB`;
}

export default async function PhotographerDashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const [supabase, dict] = await Promise.all([createClient(), getDictionary(lang as Locale)]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, profile] = await Promise.all([
    getDashboardData(),
    user ? getProfile(supabase, user.id) : null,
  ]);
  const { salesSummary, topEvent, totalEvents, storage } = data;

  const connectStatus = profile?.stripe_connect_status ?? 'not_connected';

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <DashboardHeader title={dict.photographerDashboard.overview} />

      {/* Stripe Connect banner if account not active */}
      {connectStatus !== 'active' && (
        <div className="flex flex-col gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 sm:flex-row sm:items-center dark:border-yellow-800 dark:bg-yellow-950">
          <div className="flex flex-1 items-start gap-3 sm:items-center">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 sm:mt-0 dark:text-yellow-400" />
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              {connectStatus === 'not_connected' && dict.stripeConnect.banner.connectAccount}
              {connectStatus === 'pending' && dict.stripeConnect.banner.pendingReview}
              {connectStatus === 'restricted' && dict.stripeConnect.banner.actionRequired}
            </div>
          </div>
          <Link
            href={`/${lang}/dashboard/photographer/profile/payout-profile`}
            className="shrink-0 self-start pl-8 text-sm font-medium text-yellow-800 underline sm:self-center sm:pl-0 dark:text-yellow-200"
          >
            {dict.stripeConnect.banner.goToPayoutProfile}
          </Link>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4">
        {/* Stats Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {dict.photographerDashboard.totalSales30d}
                </p>
                <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold">
                  {formatCurrency(salesSummary.totalRevenueCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {salesSummary.totalSales}{' '}
                  {salesSummary.totalSales === 1
                    ? dict.photographerDashboard.sale
                    : dict.photographerDashboard.sales}
                </p>
              </div>
              <div className="ml-2 shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">
                <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {dict.photographerDashboard.photosSold30d}
                </p>
                <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold">
                  {salesSummary.totalPhotosSold}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCurrency(salesSummary.averageOrderValueCents)}{' '}
                  {dict.photographerDashboard.avg}
                </p>
              </div>
              <div className="ml-2 shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">
                <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {dict.photographerDashboard.totalEvents}
                </p>
                <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold">{totalEvents}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {totalEvents === 1
                    ? dict.photographerDashboard.event
                    : dict.photographerDashboard.eventsCreated}{' '}
                  {dict.photographerDashboard.created}
                </p>
              </div>
              <div className="ml-2 shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">
                <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
            </div>
          </div>

          {/* Storage Card */}
          <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between h-full gap-6">
              <div className="flex flex-col flex-1 justify-between h-full">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {dict.photographerDashboard.storage}
                </p>
                <div className="space-y-1 w-full">
                  <div className="text-xs text-muted-foreground">
                    {formatStorage(storage.usedGB)} / {formatStorage(storage.limitGB)}
                  </div>
                  <div className="h-1.5 sm:h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        storage.usedPercent >= 90
                          ? 'bg-destructive'
                          : storage.usedPercent >= 70
                            ? 'bg-yellow-500'
                            : 'bg-primary',
                      )}
                      style={{ width: `${storage.usedPercent}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {storage.usedPercent.toFixed(1)}% {dict.photographerDashboard.used}
                  </p>
                </div>
              </div>
              <div className="ml-2 shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">
                <HardDrive className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
            </div>
          </div>
        </div>

        {/* Performance chart removed — re-add once there's enough sales
            data to make it useful. Keep the Top Event + Quick Actions block
            as the only main-content section for now. */}
        <div className="space-y-4 sm:space-y-6">
          {/* Top Event */}
          {topEvent ? (
            <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
              <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">
                {dict.photographerDashboard.topEvent}
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="font-medium text-base sm:text-lg">
                    {topEvent.event_name || dict.photographerDashboard.unnamedEvent}
                  </p>
                  {topEvent.event_date && (
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                      {format(new Date(topEvent.event_date), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-3 border-t">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {dict.photographerDashboard.revenue}
                    </p>
                    <p className="text-base sm:text-lg font-semibold mt-1">
                      {formatCurrency(topEvent.revenue_cents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {dict.photographerDashboard.photosSold}
                    </p>
                    <p className="text-base sm:text-lg font-semibold mt-1">
                      {topEvent.photos_sold}
                    </p>
                  </div>
                </div>
                {topEvent.event_name !== 'Deleted Event' && (
                  <ViewEventButton eventId={topEvent.event_id} />
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
              <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">
                {dict.photographerDashboard.topEvent}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {dict.photographerDashboard.noSalesYet}
              </p>
            </div>
          )}

          {/* Quick Actions */}
          <QuickActions
            title={dict.photographerDashboard.quickActionsTitle}
            createEventLabel={dict.photographerDashboard.quickActionsCreateEvent}
            viewEventsLabel={dict.photographerDashboard.quickActionsViewEvents}
          />
        </div>
      </div>
    </div>
  );
}
