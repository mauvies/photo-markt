import { DashboardHeader } from '@/components/dashboard-header';
import { countPricedEvents } from '@/database/queries/events';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { requireUser } from '@/lib/auth/require-user';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { reconcileAndPersistConnectStatus } from '@/lib/stripe/connect';
import { WelcomeEmpty } from './_components/empty-states';
import { MetricsRow } from './_components/metrics-row';
import { PerformanceChart } from './_components/performance-chart';
import { RecentEventsRow } from './_components/recent-events-row';
import { RecentSalesList } from './_components/recent-sales-list';
import { StripeConnectBanner, type StripeConnectStatus } from './_components/stripe-connect-banner';
import { SubscriptionConfirmingBanner } from './_components/subscription-confirming-banner';
import { getDashboardData } from './actions';

export default async function PhotographerDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  // Guard first — this page renders in parallel with the layouts above it, so
  // their login redirects don't stop it. Without this, a signed-out render
  // reached `getDashboardData()`, which throws `User not authenticated`, and
  // that error raced the redirects into the error boundary (same defect as
  // T-198's talent layout).
  const user = await requireUser();

  const { lang } = await params;
  const { checkout } = await searchParams;
  const [supabase, dict] = await Promise.all([createClient(), getDictionary(lang as Locale)]);

  const [data, profile, pricedEventCount] = await Promise.all([
    getDashboardData(),
    getProfile(supabase, user.id),
    // T-248: how many live events actually charge. With a non-active Connect
    // account each of them is refused at checkout, so this turns the generic
    // "connect your account" nudge into a statement of what is being lost.
    countPricedEvents(supabase, user.id),
  ]);

  const storedStatus = (profile?.stripe_connect_status ?? 'not_connected') as StripeConnectStatus;
  // Reconcile a stale cached status (e.g. a `pending` left behind by a
  // lagged/missed `account.updated` webhook) against the live Stripe account so
  // the "under review" banner doesn't show for an already-active account. The
  // helper only checks Stripe when the cached value is non-active, so the
  // common active case adds no Stripe call to this hot page.
  const connectStatus = await reconcileAndPersistConnectStatus({
    client: supabase,
    userId: user.id,
    accountId: profile?.stripe_connect_account_id,
    storedStatus,
  });
  const t = dict.photographerDashboard;
  const isBrandNew =
    data.metrics.eventsCreated === 0 &&
    data.metrics.sales === 0 &&
    data.metrics.photosUploaded === 0 &&
    data.totals.totalEvents === 0 &&
    data.totals.totalPhotos === 0;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <DashboardHeader title={t.overview} />

      {checkout === 'success' && (
        <SubscriptionConfirmingBanner
          t={{
            confirmingTitle: t.subscriptionConfirmingTitle,
            confirmingBody: t.subscriptionConfirmingBody,
            activeTitle: t.subscriptionActiveTitle,
            activeBody: t.subscriptionActiveBody,
            slowBody: t.subscriptionConfirmingSlowBody,
            refresh: t.subscriptionRefresh,
            dismiss: t.subscriptionDismiss,
          }}
        />
      )}

      <StripeConnectBanner
        status={connectStatus}
        lang={lang}
        pricedEventCount={pricedEventCount}
        t={{
          connectAccount: dict.stripeConnect.banner.connectAccount,
          pendingReview: dict.stripeConnect.banner.pendingReview,
          actionRequired: dict.stripeConnect.banner.actionRequired,
          goToPayoutProfile: dict.stripeConnect.banner.goToPayoutProfile,
          salesBlockedOne: dict.stripeConnect.banner.salesBlockedOne,
          salesBlockedMany: dict.stripeConnect.banner.salesBlockedMany,
        }}
      />
      <div className="flex flex-1 flex-col gap-4">
        {isBrandNew ? (
          <WelcomeEmpty
            lang={lang}
            t={{
              title: t.welcomeEmptyTitle,
              body: t.welcomeEmptyBody,
              ctaLabel: t.welcomeEmptyCta,
            }}
          />
        ) : (
          <>
            <MetricsRow
              metrics={data.metrics}
              t={{
                earningsThisMonth: t.earningsThisMonth,
                salesThisMonth: t.salesThisMonth,
                photosUploadedThisMonth: t.photosUploadedThisMonth,
                eventsCreatedThisMonth: t.eventsCreatedThisMonth,
                vsLastMonth: t.vsLastMonth,
              }}
            />

            {/* <QuickActionsStrip
            lang={lang}
            createEventLabel={t.createEventAction}
            viewEventsLabel={t.viewAllEventsAction}
          /> */}

            {/* Hide the performance chart entirely when there are no sales — the
                summary metrics already convey the "no data yet" state, so the
                chart's empty placeholder would just be a redundant second one.
                Without the chart, Ventas recientes spans the full width. */}
            <div
              className={
                data.recentSales.length > 0 ? 'grid gap-4 lg:grid-cols-[2fr_1fr]' : 'grid gap-4'
              }
            >
              {data.recentSales.length > 0 && (
                <PerformanceChart
                  initialSeries={data.initialSeries}
                  initialRange={data.initialRange}
                  t={{
                    title: t.performanceTitle,
                    subtitle: t.performanceSubtitle,
                    range7d: t.range7d,
                    range30d: t.range30d,
                    range3m: t.range3m,
                    earningsLabel: t.earningsThisMonth,
                    emptyTitle: t.chartEmptyTitle,
                    emptyBody: t.chartEmptyBody,
                  }}
                />
              )}
              <RecentSalesList
                sales={data.recentSales}
                lang={lang}
                t={{
                  title: t.recentSales,
                  viewAll: t.viewAll,
                  unnamedEvent: t.unnamedEvent,
                  emptyTitle: t.noSalesEmptyTitle,
                  emptyBody: t.noSalesEmptyBody,
                }}
              />
            </div>

            <RecentEventsRow
              events={data.recentEvents}
              lang={lang}
              activityLabels={dict.activities}
              eventCardLabels={{
                photo: dict.eventCard.photo,
                photos: dict.eventCard.photos,
                noPhotosYet: dict.eventCard.noPhotosYet,
                imageUnavailable: dict.eventCard.imageUnavailable,
                upcomingLabel: dict.events.statusUpcoming,
                privateEvent: dict.eventCard.privateEvent,
              }}
              t={{
                title: t.recentEvents,
                viewAll: t.viewAll,
                emptyTitle: t.noEventsEmptyTitle,
                emptyBody: t.noEventsEmptyBody,
                emptyCta: t.noEventsEmptyCta,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
