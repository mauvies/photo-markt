/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailablePlansSection } from '@/app/[lang]/dashboard/photographer/settings/available-plans-section';
import en from '@/dictionaries/en.json';
import { getPlanFeatures } from '@/lib/plan-features';
import { PLANS } from '@/lib/plans';

// Stub the upgrade button (pulls in a server action) and the period toggle.
// The stub renders `ctaLabel` so the direction-aware copy is observable here.
vi.mock('@/app/[lang]/dashboard/photographer/settings/upgrade-plan-button', () => ({
  UpgradePlanButton: ({ planId, ctaLabel }: { planId: string; ctaLabel: string }) => (
    <button type="button" data-plan={planId}>
      {ctaLabel}
    </button>
  ),
}));
vi.mock('@/components/billing-period-toggle', () => ({
  BillingPeriodToggle: () => <div data-testid="toggle" />,
}));

afterEach(cleanup);

const labels = {
  sectionTitle: 'Available plans',
  popularBadge: 'Popular',
  toggleMonthly: 'Monthly',
  toggleYearly: 'Yearly',
  toggleBadge: '2 months free',
  billedYearlyPrefix: 'Billed yearly: $',
  billedYearlySuffix: '',
  checkoutError: 'Checkout failed',
  checkoutYearlyUnavailable: 'Yearly not available',
  planChangeProcessing: 'Processing…',
  subscriptionUpdated: 'Subscription updated.',
};

describe('AvailablePlansSection', () => {
  it('renders each plan’s feature list from the shared source', () => {
    const featuresByPlan = getPlanFeatures(en.pricingSection);
    const plans = PLANS.filter((p) => p.id === 'starter' || p.id === 'pro');

    render(
      <AvailablePlansSection
        plans={plans}
        featuresByPlan={featuresByPlan}
        ctaLabelByPlan={{ starter: 'Switch to Starter', pro: 'Upgrade to Pro' }}
        isUpgradeByPlan={{ starter: false, pro: true }}
        labels={labels}
      />,
    );

    // Features unique to each plan surface in their cards (storage tiers differ).
    expect(screen.getByText(en.pricingSection.starterFeature2)).toBeTruthy(); // "50 GB storage"
    expect(screen.getByText(en.pricingSection.proFeature2)).toBeTruthy(); // "250 GB storage"
    // "Coming soon" badges render alongside the not-yet-built features
    // (outfit pattern) — at least one across the cards.
    expect(screen.getAllByText(en.pricingSection.comingSoon).length).toBeGreaterThan(0);
  });

  it('renders the CTA copy it was given per plan, without re-deriving it', () => {
    // Regression: the button used to pick its own English copy from the TARGET
    // plan alone, so a Pro subscriber was offered "Upgrade to Starter" for what
    // is a downgrade. The direction is decided by the server component, which
    // is the only place that knows the current plan and the dictionary.
    const featuresByPlan = getPlanFeatures(en.pricingSection);
    const plans = PLANS.filter((p) => p.id === 'starter');

    render(
      <AvailablePlansSection
        plans={plans}
        featuresByPlan={featuresByPlan}
        ctaLabelByPlan={{ starter: 'Switch to Starter' }}
        isUpgradeByPlan={{ starter: false }}
        labels={labels}
      />,
    );

    expect(screen.getByText('Switch to Starter')).toBeTruthy();
    expect(screen.queryByText('Upgrade to Starter')).toBeNull();
  });
});
