'use client';

import { AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';

type EarningsT = Dictionary['earnings'];

interface PayoutProfileBannerProps {
  isComplete: boolean;
}

export function PayoutProfileBanner({ isComplete }: PayoutProfileBannerProps) {
  const { t } = useTranslations<EarningsT>();

  if (isComplete) {
    return null;
  }

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
        <div className="flex-1">
          <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
            {t('payoutProfileBannerTitle')}
          </h3>
          <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
            {t('payoutProfileBannerDesc')}
          </p>
          <div className="mt-3">
            <Link href="/dashboard/photographer/settings/payout-profile">
              <Button
                size="sm"
                variant="outline"
                className="border-yellow-300 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-800 dark:text-yellow-200 dark:hover:bg-yellow-900"
              >
                {t('payoutProfileBannerButton')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
