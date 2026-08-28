/** @vitest-environment happy-dom */
/**
 * T-248 — the dashboard banner used to say the same mild "connect your account"
 * line whether the photographer had nothing for sale or money already stuck in
 * the ledger. This pins the escalation, and in particular that only genuinely
 * held money gets the red treatment: a priced event that hasn't sold yet is a
 * forecast, and a red forecast trains the photographer to ignore the colour.
 *
 * It also pins that the stake and the Stripe instruction COMPOSE. Replacing the
 * instruction with the stake told a `restricted` photographer to "connect a
 * payout account" they had already connected, dropping the only sentence that
 * said what Stripe was actually waiting for.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StripeConnectBanner } from '@/app/[lang]/dashboard/photographer/_components/stripe-connect-banner';

const t = {
  connectAccount: 'Connect your account.',
  pendingReview: 'Under review.',
  actionRequired: 'Action required.',
  goToPayoutProfile: 'Go to payout settings',
  salesWillHoldOne: '1 event on sale; your money will be held.',
  salesWillHoldMany: '{count} events on sale; your money will be held.',
  moneyHeld: 'You have {amount} waiting.',
};

afterEach(cleanup);

describe('StripeConnectBanner', () => {
  it('renders nothing when the account is active, even with priced events and held money', () => {
    const { container } = render(
      <StripeConnectBanner
        status="active"
        lang="es"
        pricedEventCount={228}
        heldCents={5000}
        t={t}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('keeps the mild setup nudge when nothing is priced and nothing is held', () => {
    render(
      <StripeConnectBanner
        status="not_connected"
        lang="es"
        pricedEventCount={0}
        heldCents={0}
        t={t}
      />,
    );
    expect(screen.getByText('Connect your account.')).toBeTruthy();
  });

  it('warns that sales will be held, naming the count, before anything has sold', () => {
    render(
      <StripeConnectBanner
        status="not_connected"
        lang="es"
        pricedEventCount={3}
        heldCents={0}
        t={t}
      />,
    );
    expect(
      screen.getByText('3 events on sale; your money will be held. Connect your account.'),
    ).toBeTruthy();
  });

  it('uses the singular copy for exactly one priced event', () => {
    render(
      <StripeConnectBanner
        status="restricted"
        lang="es"
        pricedEventCount={1}
        heldCents={0}
        t={t}
      />,
    );
    expect(screen.getByText(/1 event on sale; your money will be held\./)).toBeTruthy();
  });

  it('keeps the Stripe instruction when an account exists but cannot receive money', () => {
    // `restricted` means Stripe wants more documents — telling this photographer
    // to connect an account they already connected drops the only actionable
    // sentence. The stake must not evict the instruction.
    const { container, unmount } = render(
      <StripeConnectBanner
        status="restricted"
        lang="es"
        pricedEventCount={1}
        heldCents={0}
        t={t}
      />,
    );
    expect(container.textContent).toContain('Action required.');
    expect(container.textContent).not.toContain('Connect your account.');
    unmount();

    // Same for an account still under review, and for held money.
    const underReview = render(
      <StripeConnectBanner status="pending" lang="es" pricedEventCount={0} heldCents={900} t={t} />,
    );
    expect(underReview.container.textContent).toContain('You have €9.00 waiting.');
    expect(underReview.container.textContent).toContain('Under review.');
  });

  it('names the formatted amount, and outranks the priced-event forecast, once money is held', () => {
    render(
      <StripeConnectBanner
        status="not_connected"
        lang="es"
        pricedEventCount={3}
        heldCents={1250}
        t={t}
      />,
    );
    expect(screen.getByText('You have €12.50 waiting. Connect your account.')).toBeTruthy();
    expect(screen.queryByText(/events on sale/)).toBeNull();
  });

  it('always links to the payout settings', () => {
    render(
      <StripeConnectBanner status="pending" lang="en" pricedEventCount={2} heldCents={0} t={t} />,
    );
    expect(screen.getByText('Go to payout settings').getAttribute('href')).toBe(
      '/en/dashboard/photographer/settings/payout-profile',
    );
  });
});
