/** @vitest-environment happy-dom */
/**
 * T-248 — the dashboard banner used to say the same mild "connect your account"
 * line whether the photographer had nothing for sale or 228 photos nobody can
 * buy. This pins the escalation: with priced events it must name the count and
 * state the consequence.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StripeConnectBanner } from '@/app/[lang]/dashboard/photographer/_components/stripe-connect-banner';

const t = {
  connectAccount: 'Connect your account.',
  pendingReview: 'Under review.',
  actionRequired: 'Action required.',
  goToPayoutProfile: 'Go to payout settings',
  salesBlockedOne: 'You have 1 event on sale and no way to get paid.',
  salesBlockedMany: 'You have {count} events on sale and no way to get paid.',
};

afterEach(cleanup);

describe('StripeConnectBanner', () => {
  it('renders nothing when the account is active, even with priced events', () => {
    const { container } = render(
      <StripeConnectBanner status="active" lang="es" pricedEventCount={228} t={t} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('keeps the mild setup nudge when nothing is priced', () => {
    render(<StripeConnectBanner status="not_connected" lang="es" pricedEventCount={0} t={t} />);
    expect(screen.getByText('Connect your account.')).toBeTruthy();
  });

  it('names the count and the consequence when events are on sale', () => {
    render(<StripeConnectBanner status="not_connected" lang="es" pricedEventCount={3} t={t} />);
    expect(screen.getByText('You have 3 events on sale and no way to get paid.')).toBeTruthy();
  });

  it('uses the singular copy for exactly one priced event', () => {
    render(<StripeConnectBanner status="restricted" lang="es" pricedEventCount={1} t={t} />);
    expect(screen.getByText('You have 1 event on sale and no way to get paid.')).toBeTruthy();
  });

  it('always links to the payout settings', () => {
    render(<StripeConnectBanner status="pending" lang="en" pricedEventCount={2} t={t} />);
    expect(screen.getByText('Go to payout settings').getAttribute('href')).toBe(
      '/en/dashboard/photographer/settings/payout-profile',
    );
  });
});
