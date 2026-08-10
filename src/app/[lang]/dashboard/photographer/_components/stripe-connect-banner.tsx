import { PayoutAccountAlert } from '@/components/payout-account-alert';
import { resolvePayoutReadiness } from '@/lib/payouts/payout-readiness';

export type StripeConnectStatus = 'not_connected' | 'pending' | 'active' | 'restricted';

interface StripeConnectBannerProps {
  status: StripeConnectStatus;
  lang: string;
  /**
   * How many live events already charge for photos (T-248). Above zero, the
   * missing payout account is not a pending setup step — it is sales being
   * refused at checkout right now, so the banner says that instead.
   */
  pricedEventCount: number;
  t: {
    connectAccount: string;
    pendingReview: string;
    actionRequired: string;
    goToPayoutProfile: string;
    salesBlockedOne: string;
    salesBlockedMany: string;
  };
}

export function StripeConnectBanner({
  status,
  lang,
  pricedEventCount,
  t,
}: StripeConnectBannerProps) {
  const readiness = resolvePayoutReadiness({ connectStatus: status, pricedEventCount });
  if (!readiness) return null;

  const message =
    readiness === 'sales_blocked'
      ? pricedEventCount === 1
        ? t.salesBlockedOne
        : t.salesBlockedMany.replace('{count}', String(pricedEventCount))
      : status === 'pending'
        ? t.pendingReview
        : status === 'restricted'
          ? t.actionRequired
          : t.connectAccount;

  return (
    <PayoutAccountAlert
      severity={readiness === 'sales_blocked' ? 'blocked' : 'info'}
      message={message}
      ctaHref={`/${lang}/dashboard/photographer/settings/payout-profile`}
      ctaLabel={t.goToPayoutProfile}
    />
  );
}
