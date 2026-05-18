import { CreditCard, Database } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getCurrentPlan } from '@/database/queries';
import { getProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';
import { formatPlanPrice, PLANS } from '@/lib/plans';
import { getDashboardData } from '../actions';
import { AvailablePlansSection } from './available-plans-section';
import { PayoutProfileSection } from './payout-profile-section';
import { UpgradeHandler } from './upgrade-handler';
import { UpgradePlanButton } from './upgrade-plan-button';

function formatStorage(gb: number): string {
  if (gb < 1) {
    return `${(gb * 1024).toFixed(0)} MB`;
  }
  return `${gb.toFixed(2)} GB`;
}

export default async function PhotographerSettingsPage({
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

  const currentPlan = await getCurrentPlan(supabase, user?.id);
  const currentPlanId = currentPlan.id;
  // Show the next tier as the primary upgrade CTA — Free→Starter, Starter→Pro.
  // Avoids pushing the most expensive plan first.
  const nextPlanId: 'starter' | 'pro' | null =
    currentPlanId === 'free' ? 'starter' : currentPlanId === 'starter' ? 'pro' : null;

  // Payout profile lives here now (used to be on /profile/). Fetched alongside
  // billing so settings is the single place for "money + plan" config.
  const profile = user ? await getProfile(supabase, user.id) : null;

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <UpgradeHandler />
      <DashboardHeader title={dict.photographerDashboard.settingsTitle} />

      <div className="flex flex-1 flex-col gap-6">
        {/* Billing & Plan */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              <CardTitle>{dict.photographerDashboard.billingPlan}</CardTitle>
            </div>
            <CardDescription>{dict.photographerDashboard.billingPlanDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
            {/* Current Plan */}
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
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
                  className="w-full bg-gradient-starter border-0 text-white hover:opacity-90 sm:w-auto"
                />
              )}
            </div>

            {/* Storage Usage */}
            {currentPlan.storageGB !== null && (
              <div className="space-y-2 rounded-lg border p-4">
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

            {/* Current Plan Features */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{dict.photographerDashboard.planFeatures}</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  ...(currentPlan.storageGB !== null
                    ? [`${currentPlan.storageGB}GB storage`]
                    : ['Unlimited storage']),
                  ...currentPlan.features,
                ].map((feature) => {
                  const text = typeof feature === 'string' ? feature : feature.text;
                  return (
                    <li key={text} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Available Plans + monthly/yearly toggle — lifted into a
                client component so the toggle drives both the displayed
                price and the period the Upgrade button posts. */}
            <AvailablePlansSection
              plans={PLANS.filter((plan) => plan.id !== currentPlanId && plan.id !== 'free')}
              labels={{
                sectionTitle: dict.photographerDashboard.availablePlans,
                popularBadge: dict.photographerDashboard.popular,
                toggleMonthly: dict.pricingSection.monthly,
                toggleYearly: dict.pricingSection.yearly,
                toggleBadge: dict.pricingSection.twoMonthsFree,
                billedYearlyPrefix: dict.pricingSection.billedYearlyPrefix,
                billedYearlySuffix: dict.pricingSection.billedYearlySuffix,
              }}
            />
          </CardContent>
          <CardFooter className="p-4 pt-0 sm:p-6 sm:pt-0">
            <p className="text-xs text-muted-foreground">
              {dict.photographerDashboard.billingHelpText}
            </p>
          </CardFooter>
        </Card>

        {/* Payouts — moved here from /profile because it's an operational
            financial config, not part of the photographer's public identity. */}
        <TranslationsProvider translations={dict.photographerDashboard}>
          <PayoutProfileSection profile={profile} />
        </TranslationsProvider>
      </div>
    </div>
  );
}
