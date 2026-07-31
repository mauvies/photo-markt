import { CreditCard, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getCurrentPlan, getSubscription, hasPendingCancellation } from '@/database/queries';
import { createClient } from '@/database/server';
import { supabaseAdmin } from '@/database/supabase-admin';
import { formatEventDate } from '@/lib/format-date';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getPlanFeatures } from '@/lib/plan-features';
import { getFreePlanOverage } from '@/lib/plan-limits';
import { formatPlanPrice, getPlanById, PLANS } from '@/lib/plans';
import { getDashboardData } from '../../actions';
import { AvailablePlansSection } from '../available-plans-section';
import { BillingStatusToast } from '../billing-status-toast';
import { SubscriptionActions } from '../subscription-actions';
import { UpgradePlanButton } from '../upgrade-plan-button';

function formatStorage(gb: number): string {
  if (gb < 1) {
    return `${(gb * 1024).toFixed(0)} MB`;
  }
  return `${gb.toFixed(2)} GB`;
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export default async function PhotographerSettingsBillingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);
  const dashboardData = await getDashboardData();
  const { storage, totals } = dashboardData;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `subscriptions` is system-managed (RLS on, no policies), so the plan read
  // must use the service-role client — the user-scoped client is RLS-blocked
  // and would silently resolve every photographer to "Free". Identity comes
  // from the user-scoped `getUser()` above.
  const currentPlan = await getCurrentPlan(supabaseAdmin, user?.id);
  const currentPlanId = currentPlan.id;
  const nextPlanId: 'starter' | 'pro' | null =
    currentPlanId === 'free' ? 'starter' : currentPlanId === 'starter' ? 'pro' : null;

  // Shared, translated feature lists — same source as the landing pricing cards.
  const planFeatures = getPlanFeatures(dict.pricingSection);

  // --- Cancellation state (T-214) -------------------------------------------
  // Only paid plans can be cancelled; on Free there is nothing to cancel. The
  // row is read with the service-role client for the same RLS reason as the
  // plan above. `current_period_end` is already persisted by the webhook, so
  // the real date needs no Stripe round-trip.
  const isPaidPlan = currentPlanId !== 'free';
  const subscription =
    isPaidPlan && user?.id ? await getSubscription(supabaseAdmin, user.id) : null;
  const pendingCancellation = hasPendingCancellation(subscription);
  const periodEndLabel = formatEventDate(subscription?.current_period_end ?? undefined, lang);

  // Warn about Free's caps only where the photographer ALREADY exceeds them.
  // Nothing is ever deleted on downgrade — the limits are write-time gates —
  // so the warning is about being blocked from adding more, not losing work.
  const freePlan = getPlanById('free');
  const overage = getFreePlanOverage({
    storageUsedGB: storage.usedGB,
    eventsCount: totals.totalEvents,
  });
  const quotaWarnings: string[] = [];
  if (overage.storage && freePlan?.storageGB != null) {
    quotaWarnings.push(
      interpolate(dict.photographerDashboard.cancelSubscriptionStorageWarning, {
        usage: formatStorage(storage.usedGB),
        limit: formatStorage(freePlan.storageGB),
      }),
    );
  }
  if (overage.events && freePlan?.maxEvents != null) {
    quotaWarnings.push(
      interpolate(dict.photographerDashboard.cancelSubscriptionEventsWarning, {
        current: totals.totalEvents,
        limit: freePlan.maxEvents,
      }),
    );
  }

  const planNameValues = { planName: currentPlan.name };
  const subscriptionActionLabels = {
    cancel: dict.photographerDashboard.cancelSubscription,
    dialogTitle: interpolate(dict.photographerDashboard.cancelSubscriptionTitle, planNameValues),
    // A legacy row can lack `current_period_end`; say so honestly rather than
    // rendering "until undefined" on a screen about money.
    dialogBody: periodEndLabel
      ? interpolate(dict.photographerDashboard.cancelSubscriptionBody, {
          ...planNameValues,
          date: periodEndLabel,
        })
      : interpolate(dict.photographerDashboard.cancelSubscriptionBodyNoDate, planNameValues),
    quotaWarnings,
    dialogConfirm: dict.photographerDashboard.cancelSubscriptionConfirm,
    dialogKeep: dict.photographerDashboard.cancelSubscriptionKeep,
    dialogPending: dict.photographerDashboard.cancelSubscriptionPending,
    cancelSuccess: dict.photographerDashboard.cancelSubscriptionSuccess,
    cancelError: dict.photographerDashboard.cancelSubscriptionError,
    reactivate: dict.photographerDashboard.reactivateSubscription,
    reactivateSuccess: dict.photographerDashboard.reactivateSubscriptionSuccess,
    reactivateError: dict.photographerDashboard.reactivateSubscriptionError,
  };

  const pendingCancellationNotice = periodEndLabel
    ? interpolate(dict.photographerDashboard.subscriptionEndsOn, {
        ...planNameValues,
        date: periodEndLabel,
      })
    : interpolate(dict.photographerDashboard.subscriptionEndsOnNoDate, planNameValues);

  return (
    <>
      <BillingStatusToast
        messages={{
          cancelled: dict.photographerDashboard.checkoutCancelled,
          updated: dict.photographerDashboard.subscriptionUpdated,
          checkout_failed: dict.photographerDashboard.checkoutError,
          yearly_unavailable: dict.photographerDashboard.checkoutYearlyUnavailable,
        }}
      />
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            <CardTitle>{dict.photographerDashboard.billingPlan}</CardTitle>
          </div>
          <CardDescription>{dict.photographerDashboard.billingPlanDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          {/* Single "Plan actual" card — the current-plan heading + upgrade CTA on
              top, then the plan's feature list, then storage usage (no inner
              border) so it all reads as one consolidated card. */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{dict.photographerDashboard.currentPlan}</p>
                <p className="text-sm text-muted-foreground">
                  {currentPlan.name} Plan
                  {currentPlan.pricing !== null && ` • ${formatPlanPrice(currentPlan)}`}
                </p>
              </div>
              {nextPlanId && (
                <UpgradePlanButton
                  planId={nextPlanId}
                  checkoutErrorLabel={dict.photographerDashboard.checkoutError}
                  yearlyUnavailableLabel={dict.photographerDashboard.checkoutYearlyUnavailable}
                  className="w-full bg-gradient-starter border-0 text-white hover:opacity-90 sm:w-auto"
                />
              )}
            </div>

            {/* Cancellation (T-214). Paid plans only — Free has nothing to
                cancel. When a cancellation is pending the card states the real
                period-end date and offers the undo; otherwise the cancel action
                stays deliberately quiet so it never competes with the upgrade
                CTA above. */}
            {isPaidPlan && (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                {pendingCancellation && (
                  <p className="text-sm text-muted-foreground">{pendingCancellationNotice}</p>
                )}
                <SubscriptionActions
                  pendingCancellation={pendingCancellation}
                  labels={subscriptionActionLabels}
                />
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{dict.photographerDashboard.planFeatures}</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {planFeatures[currentPlanId].map((feature) => (
                  <li key={feature.text} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      {feature.text}
                      {feature.badge && (
                        <Badge variant="secondary" className="ml-1.5 py-0 text-[10px]">
                          {feature.badge}
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {currentPlan.storageGB !== null && (
              <div className="space-y-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">{dict.photographerDashboard.storageUsage}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatStorage(storage.usedGB)} / {formatStorage(currentPlan.storageGB)}
                  </p>
                </div>
                <Progress
                  value={Math.min((storage.usedGB / currentPlan.storageGB) * 100, 100)}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {totals.totalPhotos} {dict.photographerDashboard.photosUploaded}
                </p>
                {storage.usedGB >= currentPlan.storageGB && (
                  <p className="mt-2 text-xs font-medium text-destructive">
                    {dict.photographerDashboard.storageLimitReached}
                  </p>
                )}
              </div>
            )}
          </div>

          <AvailablePlansSection
            plans={PLANS.filter((plan) => plan.id !== currentPlanId && plan.id !== 'free')}
            featuresByPlan={planFeatures}
            labels={{
              sectionTitle: dict.photographerDashboard.availablePlans,
              popularBadge: dict.photographerDashboard.popular,
              toggleMonthly: dict.pricingSection.monthly,
              toggleYearly: dict.pricingSection.yearly,
              toggleBadge: dict.pricingSection.twoMonthsFree,
              billedYearlyPrefix: dict.pricingSection.billedYearlyPrefix,
              billedYearlySuffix: dict.pricingSection.billedYearlySuffix,
              checkoutError: dict.photographerDashboard.checkoutError,
              checkoutYearlyUnavailable: dict.photographerDashboard.checkoutYearlyUnavailable,
            }}
          />
        </CardContent>
        <CardFooter className="p-4 pt-0 sm:p-6 sm:pt-0">
          <p className="text-xs text-muted-foreground">
            {dict.photographerDashboard.billingHelpText}
          </p>
        </CardFooter>
      </Card>
    </>
  );
}
