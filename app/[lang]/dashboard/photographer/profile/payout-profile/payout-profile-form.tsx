'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Profile } from '@/database/queries/profiles';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { COMMON_COUNTRIES } from '../../earnings/bank-account-fields';
import {
  connectStripeAccountAction,
  refreshStripeAccountLinkAction,
  updatePayoutProfileAction,
} from './actions';

type PayoutProfileT = Dictionary['payoutProfile'];

function StripeWordmark({ className }: { className?: string }) {
  return <span className={cn('font-bold tracking-tight text-[#635BFF]', className)}>stripe</span>;
}

interface StripeConnectCardProps {
  status: 'not_connected' | 'pending' | 'active' | 'restricted';
  lang: string;
  translations: Dictionary['stripeConnect'];
}

function StripeConnectCard({ status, lang, translations: t }: StripeConnectCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleConnect = () => {
    startTransition(async () => {
      await connectStripeAccountAction(lang);
    });
  };

  const handleRefresh = () => {
    startTransition(async () => {
      await refreshStripeAccountLinkAction(lang);
    });
  };

  const borderClass = {
    not_connected: 'border-border',
    pending: 'border-violet-300 dark:border-violet-600',
    active: 'border-green-300 dark:border-green-700',
    restricted: 'border-orange-300 dark:border-orange-700',
  }[status];

  const badgeClass = {
    not_connected: 'bg-muted text-muted-foreground',
    pending: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    restricted: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  }[status];

  const statusLabel = {
    not_connected: t.statusCard.notConnected,
    pending: t.statusCard.pending,
    active: t.statusCard.active,
    restricted: t.statusCard.restricted,
  }[status];

  const description = {
    not_connected: t.notConnectedDescription,
    pending: t.pendingDescription,
    active: t.activeDescription,
    restricted: t.restrictedDescription,
  }[status];

  return (
    <div className={cn('rounded-xl border bg-card p-6 shadow-sm', borderClass)}>
      <div className="flex items-start justify-between mb-3 gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{t.statusCard.title}</h3>
          <span className={cn('rounded-full px-3 py-1 text-xs font-medium', badgeClass)}>
            {statusLabel}
          </span>
        </div>
        <StripeWordmark className="h-5 w-auto shrink-0 mt-0.5" />
      </div>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>

      {status === 'not_connected' && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={handleConnect} disabled={isPending} className="gap-2">
            {isPending ? (
              '...'
            ) : (
              <>
                <StripeIcon />
                {t.connectButton}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">{t.poweredByStripe}</p>
        </div>
      )}

      {status === 'pending' && (
        <Button variant="outline" onClick={handleRefresh} disabled={isPending} className="gap-2">
          {isPending ? (
            '...'
          ) : (
            <>
              <StripeIcon />
              {t.completeSetupButton}
            </>
          )}
        </Button>
      )}

      {status === 'restricted' && (
        <Button variant="outline" onClick={handleRefresh} disabled={isPending} className="gap-2">
          {isPending ? (
            '...'
          ) : (
            <>
              <StripeIcon />
              {t.updateAccountButton}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function StripeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      <rect width="40" height="40" rx="7" fill="#635BFF" />
      <path
        d="M20.5 16.5c0-1.4 1.1-1.9 2.9-1.9 2.6 0 5.8.8 8.4 2.1v-7.9C29.3 8 26.6 7.5 23.9 7.5c-6.5 0-10.9 3.4-10.9 9.1 0 8.9 12.3 7.4 12.3 11.3 0 1.6-1.4 2.1-3.2 2.1-2.8 0-6.5-1.2-9.3-2.8v8c2.5 1.1 6.2 1.8 9.3 1.8 6.8 0 11.4-3.4 11.4-9.2-.1-9.5-12.5-7.8-13-11.3z"
        fill="white"
      />
    </svg>
  );
}

interface PayoutProfileFormProps {
  initialData?: Profile | null;
  connectStatus: 'not_connected' | 'pending' | 'active' | 'restricted';
  lang: string;
  stripeConnectTranslations: Dictionary['stripeConnect'];
}

export function PayoutProfileForm({
  initialData,
  connectStatus,
  lang,
  stripeConnectTranslations,
}: PayoutProfileFormProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const { t } = useTranslations<PayoutProfileT>();

  const [fullName, setFullName] = useState(initialData?.full_name ?? '');
  const [countryCode, setCountryCode] = useState(initialData?.country_code ?? '');
  const [city, setCity] = useState(initialData?.city ?? '');
  const [addressLine1, setAddressLine1] = useState(initialData?.address_line1 ?? '');
  const [addressLine2, setAddressLine2] = useState(initialData?.address_line2 ?? '');
  const [stateOrRegion, setStateOrRegion] = useState(initialData?.state_or_region ?? '');
  const [postalCode, setPostalCode] = useState(initialData?.postal_code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError(t('errorFullNameRequired'));
      return;
    }
    if (!countryCode) {
      setError(t('errorCountryRequired'));
      return;
    }
    if (!city.trim()) {
      setError(t('errorCityRequired'));
      return;
    }
    if (!addressLine1.trim()) {
      setError(t('errorAddressLine1Required'));
      return;
    }
    if (!postalCode.trim()) {
      setError(t('errorPostalCodeRequired'));
      return;
    }

    startTransition(async () => {
      try {
        await updatePayoutProfileAction({
          full_name: fullName.trim(),
          country_code: countryCode,
          city: city.trim(),
          address_line1: addressLine1.trim(),
          address_line2: addressLine2.trim() || null,
          state_or_region: stateOrRegion.trim() || null,
          postal_code: postalCode.trim(),
          is_payout_profile_complete: true,
        });
        router.push(lp('/dashboard/photographer/profile'));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorSaveFailed'));
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Stripe Connect Section */}
      <StripeConnectCard
        status={connectStatus}
        lang={lang}
        translations={stripeConnectTranslations}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Information */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">{t('sectionPersonalInfo')}</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t('labelFullName')} *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('placeholderFullName')}
                disabled={isPending}
                required
              />
              <p className="text-xs text-muted-foreground">{t('helperFullName')}</p>
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">{t('sectionAddress')}</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="countryCode">{t('labelCountry')} *</Label>
              <Select
                value={countryCode}
                onValueChange={setCountryCode}
                disabled={isPending}
                required
              >
                <SelectTrigger id="countryCode">
                  <SelectValue placeholder={t('placeholderCountry')} />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">{t('labelCity')} *</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t('placeholderCity')}
                  disabled={isPending}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">{t('labelPostalCode')} *</Label>
                <Input
                  id="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder={t('placeholderPostalCode')}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="addressLine1">{t('labelAddressLine1')} *</Label>
              <Input
                id="addressLine1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder={t('placeholderAddressLine1')}
                disabled={isPending}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="addressLine2">{t('labelAddressLine2')}</Label>
              <Input
                id="addressLine2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder={t('placeholderAddressLine2')}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stateOrRegion">{t('labelStateOrRegion')}</Label>
              <Input
                id="stateOrRegion"
                value={stateOrRegion}
                onChange={(e) => setStateOrRegion(e.target.value)}
                placeholder={t('placeholderStateOrRegion')}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">{t('helperStateOrRegion')}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
          >
            {t('buttonCancel')}
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? t('buttonSaving') : t('buttonComplete')}
          </Button>
        </div>
      </form>
    </div>
  );
}
