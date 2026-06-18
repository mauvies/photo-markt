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
import { getCurrentPlan } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { getPlanFeatures } from '@/lib/plan-features';
import { formatPlanPrice, PLANS } from '@/lib/plans';
import { getDashboardData } from '../../actions';
import { AvailablePlansSection } from '../available-plans-section';
import { UpgradeHandler } from '../upgrade-handler';
import { UpgradePlanButton } from '../upgrade-plan-button';

function formatStorage(gb: number): string {
  if (gb < 1) {
    return `${(gb * 1024).toFixed(0)} MB`;
  }
  return `${gb.toFixed(2)} GB`;
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

  const currentPlan = await getCurrentPlan(supabase, user?.id);
  const currentPlanId = currentPlan.id;
  const nextPlanId: 'starter' | 'pro' | null =
    currentPlanId === 'free' ? 'starter' : currentPlanId === 'starter' ? 'pro' : null;

  // Shared, translated feature lists — same source as the landing pricing cards.
  const planFeatures = getPlanFeatures(dict.pricingSection);

  return (
    <>
      <UpgradeHandler />
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            <CardTitle>{dict.photographerDashboard.billingPlan}</CardTitle>
          </div>
          <CardDescription>{dict.photographerDashboard.billingPlanDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
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
