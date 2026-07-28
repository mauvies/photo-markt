'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BillingPeriodToggle } from '@/components/billing-period-toggle';
import { PricingPlanButton } from '@/components/pricing-plan-button';
import { Badge } from '@/components/ui/badge';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { getPlanFeatures } from '@/lib/plan-features';
import { type BillingPeriod, getPlanById } from '@/lib/plans';

type PricingT = Dictionary['pricingSection'];

export function PricingSection({ isAuthenticated, t }: { isAuthenticated: boolean; t: PricingT }) {
  const [billing, setBilling] = useState<BillingPeriod>('yearly');
  const isYearly = billing === 'yearly';
  const lp = useLocalizedPath();

  // Shared with the billing settings page so the two never drift apart.
  const planFeatures = getPlanFeatures(t);

  // Read pricing from `lib/plans.ts` (single source of truth) so the home
  // page and the settings page can't drift apart. Free plan has no pricing
  // and renders the zero amounts.
  const starterPricing = getPlanById('starter')?.pricing ?? null;
  const proPricing = getPlanById('pro')?.pricing ?? null;
  const plans = [
    {
      id: 'free' as const,
      name: t.freeName,
      description: t.freeDesc,
      monthlyPrice: 0,
      yearlyMonthlyPrice: 0,
      yearlyTotal: 0,
    },
    {
      id: 'starter' as const,
      name: t.starterName,
      description: t.starterDesc,
      monthlyPrice: starterPricing?.monthly ?? 0,
      yearlyMonthlyPrice: starterPricing?.yearlyMonthlyEquivalent ?? 0,
      yearlyTotal: starterPricing?.yearlyTotal ?? 0,
      popular: true,
    },
    {
      id: 'pro' as const,
      name: t.proName,
      description: t.proDesc,
      monthlyPrice: proPricing?.monthly ?? 0,
      yearlyMonthlyPrice: proPricing?.yearlyMonthlyEquivalent ?? 0,
      yearlyTotal: proPricing?.yearlyTotal ?? 0,
    },
  ];

  const ctaLabel = (planId: 'free' | 'starter' | 'pro') => {
    if (planId === 'free') return t.ctaFree;
    if (planId === 'starter') return t.ctaStarter;
    return t.ctaPro;
  };

  return (
    <section className="bg-linear-to-b from-muted/20 via-background to-background py-16 sm:py-20">
      <div className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mt-4 text-3xl font-semibold text-foreground sm:text-4xl">{t.headline}</h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">{t.subheadline}</p>
        </div>

        {/* Billing toggle */}
        <div className="mt-8">
          <BillingPeriodToggle
            value={billing}
            onChange={setBilling}
            labels={{ monthly: t.monthly, yearly: t.yearly, badge: t.twoMonthsFree }}
          />
        </div>

        {/* Plan cards */}
        <div className="mx-auto mt-10 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isFree = plan.id === 'free';
            const price = isYearly ? plan.yearlyMonthlyPrice : plan.monthlyPrice;
            const features = planFeatures[plan.id];

            return (
              <div
                key={plan.id}
                className={[
                  'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all duration-200',
                  'hover:translate-y-[-2px] hover:shadow-md',
                  plan.popular
                    ? 'sm:-mt-2 shadow-lg border-[#ee9da4] bg-gradient-starter-card hover:border-[#ed737d]'
                    : 'hover:border-primary/40',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span
                      style={{ borderColor: 'rgb(225, 46, 61)' }}
                      className="bg-gradient-starter rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
                    >
                      {t.mostPopular}
                    </span>
                  </div>
                )}

                {/* Plan name + price */}
                <div className="mb-5">
                  <h3 className="text-xl font-semibold">{plan.name}</h3>

                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-semibold">{`${PLATFORM_CURRENCY_SYMBOL}${price}`}</span>
                    <span className="text-xs text-muted-foreground">{t.perMonth}</span>
                  </div>

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {isYearly && plan.yearlyTotal !== null && plan.yearlyTotal > 0
                      ? `${t.billedYearlyPrefix}${plan.yearlyTotal}${t.billedYearlySuffix}`
                      : ' '}
                  </p>
                </div>

                {/* Features */}
                <ul className="mb-6 flex-1 space-y-2.5">
                  {features.map((f) => (
                    <li key={f.text} className="flex items-center gap-2.5">
                      <div className="shrink-0 rounded-full bg-primary/10 p-1 text-primary">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <span className={f.bold ? 'text-[13px] font-semibold' : 'text-[13px]'}>
                        {f.text}
                        {f.badge && (
                          <Badge variant="secondary" className="ml-1.5 py-0 text-[10px]">
                            {f.badge}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-auto">
                  <PricingPlanButton
                    planId={plan.id}
                    isFree={isFree}
                    isAuthenticated={isAuthenticated}
                    period={billing}
                    label={ctaLabel(plan.id)}
                    loadingLabel={t.ctaProcessing}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mx-auto mt-4 max-w-6xl pt-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            {t.footerNote}{' '}
            <Link
              href={lp('/contact')}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t.footerContact}
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
