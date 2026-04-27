'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PricingPlanButton } from '@/components/pricing-plan-button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

type BillingPeriod = 'monthly' | 'yearly';

type PlanFeature = { text: string; bold?: boolean; badge?: string };

const PLAN_FEATURES: Record<string, PlanFeature[]> = {
  free: [
    { text: '12% sales fee', bold: true },
    { text: '20GB storage' },
    { text: 'Up to 5 active events' },
    { text: 'BIB number recognition' },
    { text: 'Face recognition (100 searches/month)' },
    { text: 'Basic analytics' },
  ],
  starter: [
    { text: '8% sales fee', bold: true },
    { text: '50GB storage' },
    { text: 'Unlimited events' },
    { text: 'BIB number recognition' },
    { text: 'Face recognition' },
    { text: 'Advanced analytics' },
    { text: 'Priority in search results' },
  ],
  pro: [
    { text: '5% sales fee', bold: true },
    { text: '250GB storage' },
    { text: 'Unlimited events' },
    { text: 'BIB number recognition' },
    { text: 'Face recognition' },
    { text: 'Outfit pattern recognition', badge: 'Coming soon' },
    { text: 'Highest priority in search results' },
  ],
};

type PlanCard = {
  id: 'free' | 'starter' | 'pro';
  name: string;
  description: string;
  monthlyPrice: number | null;
  yearlyMonthlyPrice: number | null;
  yearlyTotal: number | null;
  popular?: boolean;
};

const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Perfect for getting started and testing Photo Markt',
    monthlyPrice: null,
    yearlyMonthlyPrice: null,
    yearlyTotal: null,
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'For active photographers who publish events regularly',
    monthlyPrice: 14.99,
    yearlyMonthlyPrice: 11.99,
    yearlyTotal: 143.88,
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For professional photographers and studios',
    monthlyPrice: 29.99,
    yearlyMonthlyPrice: 23.99,
    yearlyTotal: 287.88,
  },
];

export function PricingSection({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [billing, setBilling] = useState<BillingPeriod>('yearly');
  const isYearly = billing === 'yearly';

  return (
    <section className="bg-linear-to-b from-muted/20 via-background to-background py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mt-4 text-3xl font-semibold text-foreground sm:text-4xl">
            Simple pricing for photographers.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Start for free and scale as your gallery grows. No hidden fees.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <span
            className={
              !isYearly ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'
            }
          >
            Monthly
          </span>
          <Switch
            checked={isYearly}
            onCheckedChange={(v) => setBilling(v ? 'yearly' : 'monthly')}
            aria-label="Toggle billing period"
          />
          <span
            className={
              isYearly ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'
            }
          >
            Yearly
          </span>
          {isYearly && (
            <Badge variant="secondary" className="ml-1 text-[11px]">
              2 months free
            </Badge>
          )}
        </div>

        {/* Plan cards */}
        <div className="mx-auto mt-10 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PLAN_CARDS.map((plan) => {
            const isFree = plan.id === 'free';
            const price = isYearly ? plan.yearlyMonthlyPrice : plan.monthlyPrice;
            const features = PLAN_FEATURES[plan.id] ?? [];

            return (
              <div
                key={plan.id}
                className={[
                  'relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-200',
                  'hover:-translate-y-[2px] hover:border-primary/40 hover:shadow-md',
                  plan.popular &&
                    'sm:-mt-2 bg-linear-to-b from-primary/5 to-card ring-1 ring-primary/40 ring-offset-1 ring-offset-background shadow-lg',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm">
                      Most popular
                    </span>
                  </div>
                )}

                {/* Plan name + price */}
                <div className="mb-5">
                  <h3 className="text-xl font-semibold">{plan.name}</h3>

                  <div className="mt-3 flex items-baseline gap-2">
                    {price !== null ? (
                      <>
                        <span className="text-3xl font-semibold">${price}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </>
                    ) : (
                      <span className="text-3xl font-semibold">Free</span>
                    )}
                  </div>

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {isYearly && plan.yearlyTotal !== null
                      ? `Billed $${plan.yearlyTotal}/year`
                      : '\u00a0'}
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
                          <Badge variant="secondary" className="ml-1.5 text-[10px] py-0">
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
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mx-auto mt-10 max-w-6xl border-t border-border/40 pt-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            Need a custom plan for large studios or organizers?{' '}
            <Link href="/contact" className="underline underline-offset-4 hover:text-foreground">
              Contact us
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
