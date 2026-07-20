'use client';

import { AlertCircle, CheckCircle2, MapPin } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Profile } from '@/database/queries/profiles';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';

type PhotographerDashboardT = Dictionary['photographerDashboard'];

interface PayoutProfileSectionProps {
  profile: Profile | null;
}

export function PayoutProfileSection({ profile }: PayoutProfileSectionProps) {
  const { t } = useTranslations<PhotographerDashboardT>();
  const lp = useLocalizedPath();

  const isComplete = profile?.is_payout_profile_complete ?? false;
  const connectStatus = profile?.stripe_connect_status ?? 'not_connected';

  const connectBadgeClass = {
    not_connected: 'bg-muted text-muted-foreground',
    pending: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    restricted: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  }[connectStatus];

  const connectLabel = {
    not_connected: t('stripeNotConnected'),
    pending: t('stripePending'),
    active: t('stripeActive'),
    restricted: t('stripeRestricted'),
  }[connectStatus];

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm lg:h-full lg:flex lg:flex-col">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">{t('payoutProfileTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('payoutProfileDesc')}</p>
        </div>
        <Link href={lp('/dashboard/photographer/settings/payout-profile')}>
          <Button variant="outline" size="sm">
            {isComplete ? t('payoutProfileEdit') : t('payoutProfileCompleteButton')}
          </Button>
        </Link>
      </div>

      <div className="lg:flex-1 lg:flex lg:flex-col space-y-4">
        {/* Personal info */}
        {!isComplete ? (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {t('payoutProfileIncompleteTitle')}
                </p>
                <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                  {t('payoutProfileIncompleteDesc')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                {t('payoutProfileCompleteStatus')}
              </span>
            </div>

            {profile?.full_name && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{t('payoutLegalName')}</p>
                  <p className="text-sm font-medium">{profile.full_name}</p>
                </div>
              </div>
            )}

            {(profile?.address_line1 || profile?.city || profile?.country_code) && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-1.5">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{t('payoutAddress')}</p>
                  <p className="text-sm font-medium">
                    {[
                      profile.address_line1,
                      profile.address_line2,
                      profile.city,
                      profile.state_or_region,
                      profile.postal_code,
                      profile.country_code,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stripe Connect status */}
        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#635BFF]">stripe</span>
            <span className="text-xs text-muted-foreground">{t('stripeConnectLabel')}</span>
          </div>
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', connectBadgeClass)}>
            {connectLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
