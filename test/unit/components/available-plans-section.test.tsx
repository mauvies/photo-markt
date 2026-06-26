/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailablePlansSection } from '@/app/[lang]/dashboard/photographer/settings/available-plans-section';
import en from '@/dictionaries/en.json';
import { getPlanFeatures } from '@/lib/plan-features';
import { PLANS } from '@/lib/plans';

// Stub the upgrade button (pulls in a server action) and the period toggle.
vi.mock('@/app/[lang]/dashboard/photographer/settings/upgrade-plan-button', () => ({
  UpgradePlanButton: ({ planId }: { planId: string }) => <button type="button">{planId}</button>,
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
};

describe('AvailablePlansSection', () => {
  it('renders each plan’s feature list from the shared source', () => {
    const featuresByPlan = getPlanFeatures(en.pricingSection);
    const plans = PLANS.filter((p) => p.id === 'starter' || p.id === 'pro');

    render(<AvailablePlansSection plans={plans} featuresByPlan={featuresByPlan} labels={labels} />);

    // Features unique to each plan surface in their cards (storage tiers differ).
    expect(screen.getByText(en.pricingSection.starterFeature2)).toBeTruthy(); // "50 GB storage"
    expect(screen.getByText(en.pricingSection.proFeature2)).toBeTruthy(); // "250 GB storage"
    // "Coming soon" badges render alongside the not-yet-built features
    // (outfit pattern) — at least one across the cards.
    expect(screen.getAllByText(en.pricingSection.comingSoon).length).toBeGreaterThan(0);
  });
});
