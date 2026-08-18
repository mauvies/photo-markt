import { PayoutAccountAlert } from '@/components/payout-account-alert';
import { PLATFORM_CURRENCY_CODE } from '@/lib/currency';
import { resolvePayoutReadiness } from '@/lib/payouts/payout-readiness';

export type StripeConnectStatus = 'not_connected' | 'pending' | 'active' | 'restricted';

interface StripeConnectBannerProps {
  status: StripeConnectStatus;
  lang: string;
  /** Live events that charge for photos — the sales that will be held (T-248). */
  pricedEventCount: number;
  /** Already-held earnings in cents. Money waiting outranks money forecast. */
  heldCents: number;
  t: {
    connectAccount: string;
    pendingReview: string;
    actionRequired: string;
    goToPayoutProfile: string;
    salesWillHoldOne: string;
    salesWillHoldMany: string;
    moneyHeld: string;
  };
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: PLATFORM_CURRENCY_CODE,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function StripeConnectBanner({
  status,
  lang,
  pricedEventCount,
  heldCents,
  t,
}: StripeConnectBannerProps) {
  const readiness = resolvePayoutReadiness({
    connectStatus: status,
    pricedEventCount,
    heldCents,
  });
  if (!readiness) return null;

  // What the photographer must actually DO. An account that exists but can't
  // receive money yet ('pending' review, 'restricted' missing documents) has a
  // different instruction from one that was never connected — and it is the
  // only actionable sentence on the strip.
  const instruction =
    status === 'pending'
      ? t.pendingReview
      : status === 'restricted'
        ? t.actionRequired
        : t.connectAccount;

  // The stake (money held / sales that will hold) COMPOSES with the
  // instruction, never replaces it. Replacing it told a `restricted`
  // photographer to "connect a payout account" they had already connected,
  // dropping the one line that said what Stripe was waiting for.
  let stake: string | null;
  if (readiness === 'money_held') {
    stake = t.moneyHeld.replace('{amount}', formatCents(heldCents));
  } else if (readiness === 'sales_will_hold') {
    stake =
      pricedEventCount === 1
        ? t.salesWillHoldOne
        : t.salesWillHoldMany.replace('{count}', String(pricedEventCount));
  } else {
    stake = null;
  }

  const message = stake ? `${stake} ${instruction}` : instruction;

  return (
    <PayoutAccountAlert
      // Only money already earned and stuck is an emergency. A priced event that
      // hasn't sold yet is a forecast, and dressing a forecast in red teaches the
      // photographer to ignore the colour.
      severity={readiness === 'money_held' ? 'blocked' : 'info'}
      message={message}
      ctaHref={`/${lang}/dashboard/photographer/settings/payout-profile`}
      ctaLabel={t.goToPayoutProfile}
    />
  );
}
