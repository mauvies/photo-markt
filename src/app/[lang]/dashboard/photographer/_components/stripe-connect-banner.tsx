import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export type StripeConnectStatus = 'not_connected' | 'pending' | 'active' | 'restricted';

interface StripeConnectBannerProps {
  status: StripeConnectStatus;
  lang: string;
  t: {
    connectAccount: string;
    pendingReview: string;
    actionRequired: string;
    goToPayoutProfile: string;
  };
}

export function StripeConnectBanner({ status, lang, t }: StripeConnectBannerProps) {
  if (status === 'active') return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 sm:flex-row sm:items-center dark:border-yellow-800 dark:bg-yellow-950">
      <div className="flex flex-1 items-start gap-3 sm:items-center">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 sm:mt-0 dark:text-yellow-400" />
        <div className="text-sm text-yellow-800 dark:text-yellow-200">
          {status === 'not_connected' && t.connectAccount}
          {status === 'pending' && t.pendingReview}
          {status === 'restricted' && t.actionRequired}
        </div>
      </div>
      <Link
        href={`/${lang}/dashboard/photographer/settings/payout-profile`}
        className="shrink-0 self-start pl-8 text-sm font-medium text-yellow-800 underline sm:self-center sm:pl-0 dark:text-yellow-200"
      >
        {t.goToPayoutProfile}
      </Link>
    </div>
  );
}
