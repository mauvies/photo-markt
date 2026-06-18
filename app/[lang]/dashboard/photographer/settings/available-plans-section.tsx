'use client';

import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { BillingPeriodToggle } from '@/components/billing-period-toggle';
import { Badge } from '@/components/ui/badge';
import type { PlanFeatureItem } from '@/lib/plan-features';
import { type BillingPeriod, formatPlanPrice, type Plan, type PlanId } from '@/lib/plans';
import { UpgradePlanButton } from './upgrade-plan-button';

interface AvailablePlansSectionProps {
  /** All plans the user is *not* currently on. */
  plans: Plan[];
  /** Per-plan feature lists (shared with the landing pricing cards). */
  featuresByPlan: Record<PlanId, PlanFeatureItem[]>;
  /** Labels — fed from the parent server component's dict so the
   * settings page stays mostly server-rendered. */
  labels: {
    sectionTitle: string;
    popularBadge: string;
    toggleMonthly: string;
    toggleYearly: string;
    toggleBadge: string;
    /** Renders as "{prefix}{amount}{suffix}" under the yearly price card. */
    billedYearlyPrefix: string;
    billedYearlySuffix: string;
  };
}

/**
 * Available plans grid + monthly/yearly toggle. Lives as a client component
 * because the toggle state has to drive both the price displayed on each
 * card and the period passed to the Upgrade button. The rest of the
 * settings page stays server-rendered.
 */
export function AvailablePlansSection({
  plans,
  featuresByPlan,
  labels,
}: AvailablePlansSectionProps) {
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const isYearly = billing === 'yearly';

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{labels.sectionTitle}</p>

      <BillingPeriodToggle
        value={billing}
        onChange={setBilling}
        labels={{
          monthly: labels.toggleMonthly,
          yearly: labels.toggleYearly,
          badge: labels.toggleBadge,
        }}
      />

      <div className="grid gap-4 pt-4 sm:grid-cols-2">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={[
              'relative rounded-lg border p-4 transition-all sm:p-5',
              plan.popular
                ? 'shadow-lg border-[#ee9da4] bg-gradient-starter-card hover:border-[#ed737d]'
                : 'hover:border-primary/50',
            ].join(' ')}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-gradient-starter rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
                  {labels.popularBadge}
                </span>
              </div>
            )}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-semibold">{plan.name}</h4>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                <p className="mt-2 text-lg font-bold">{formatPlanPrice(plan, billing)}</p>
                {isYearly && plan.pricing !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    {labels.billedYearlyPrefix}
                    {plan.pricing.yearlyTotal}
                    {labels.billedYearlySuffix}
                  </p>
                )}
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {featuresByPlan[plan.id].map((feature) => (
                <li key={feature.text} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className={feature.bold ? 'font-medium' : undefined}>
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

            <div className="mt-4">
              {/* Free is filtered out by the parent — the UpgradePlanButton
                  only accepts starter/pro. */}
              {(plan.id === 'starter' || plan.id === 'pro') && (
                <UpgradePlanButton
                  planId={plan.id}
                  period={billing}
                  className={
                    plan.popular
                      ? 'w-full bg-gradient-starter border-0 text-white hover:opacity-90'
                      : 'w-full'
                  }
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
