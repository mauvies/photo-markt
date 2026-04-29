'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
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
import { COMMON_COUNTRIES, getBankAccountFields } from '../../earnings/bank-account-fields';
import { updatePayoutProfileAction } from './actions';

type PayoutProfileT = Dictionary['payoutProfile'];

interface PayoutProfileFormProps {
  initialData?: Profile | null;
}

export function PayoutProfileForm({ initialData }: PayoutProfileFormProps) {
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
  const [payoutMethod, setPayoutMethod] = useState<'bank_transfer' | 'paypal' | 'other' | ''>(
    (initialData?.payout_method as 'bank_transfer' | 'paypal' | 'other' | '') ?? '',
  );
  const [payoutDetails, setPayoutDetails] = useState('');
  const [payoutDetails2, setPayoutDetails2] = useState('');
  const [payoutDetails3, setPayoutDetails3] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const bankFields = countryCode ? getBankAccountFields(countryCode) : null;

  useEffect(() => {
    if (initialData?.payout_details_json) {
      const details = initialData.payout_details_json as Record<string, unknown>;
      if (initialData.payout_method === 'paypal') {
        setPayoutDetails((details.email as string) ?? '');
      } else if (initialData.payout_method === 'bank_transfer') {
        if (details.iban) {
          setPayoutDetails(details.iban as string);
        } else {
          const firstKey = Object.keys(details)[0];
          if (firstKey && firstKey !== 'country_code') {
            setPayoutDetails(details[firstKey] as string);
          }
        }
        const keys = Object.keys(details).filter((k) => k !== 'country_code');
        if (keys.length > 1) setPayoutDetails2(details[keys[1]] as string);
        if (keys.length > 2) setPayoutDetails3(details[keys[2]] as string);
      } else {
        setPayoutDetails((details.other as string) ?? '');
      }
    }
  }, [initialData]);

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
    if (!payoutMethod) {
      setError(t('errorPayoutMethodRequired'));
      return;
    }

    let payoutDetailsJson: Record<string, unknown> = {};

    if (payoutMethod === 'paypal') {
      if (!payoutDetails.trim() || !payoutDetails.includes('@')) {
        setError(t('errorPaypalEmailRequired'));
        return;
      }
      payoutDetailsJson = { email: payoutDetails.trim() };
    } else if (payoutMethod === 'bank_transfer') {
      if (!payoutDetails.trim()) {
        setError(
          bankFields?.label1
            ? `${bankFields.label1} ${t('errorFieldRequired')}`
            : t('errorBankDetailsRequired'),
        );
        return;
      }
      if (bankFields?.label2 && !payoutDetails2.trim()) {
        setError(`${bankFields.label2} ${t('errorFieldRequired')}`);
        return;
      }
      if (bankFields?.label3 && !payoutDetails3.trim()) {
        setError(`${bankFields.label3} ${t('errorFieldRequired')}`);
        return;
      }

      if (bankFields?.label1 === 'IBAN') {
        payoutDetailsJson = {
          iban: payoutDetails.trim().replace(/\s/g, '').toUpperCase(),
        };
      } else {
        const field1Key = bankFields?.label1?.toLowerCase().replace(/\s/g, '_') ?? '';
        payoutDetailsJson[field1Key] = payoutDetails.trim();
        if (bankFields?.label2 && payoutDetails2.trim()) {
          const field2Key = bankFields?.label2?.toLowerCase().replace(/\s/g, '_') ?? '';
          payoutDetailsJson[field2Key] = payoutDetails2.trim();
        }
        if (bankFields?.label3 && payoutDetails3.trim()) {
          const field3Key = bankFields?.label3?.toLowerCase().replace(/\s/g, '_') ?? '';
          payoutDetailsJson[field3Key] = payoutDetails3.trim();
        }
        payoutDetailsJson.country_code = countryCode;
      }
    } else {
      if (!payoutDetails.trim()) {
        setError(t('errorAccountDetailsRequired'));
        return;
      }
      payoutDetailsJson = { other: payoutDetails.trim() };
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
          payout_method: payoutMethod as 'bank_transfer' | 'paypal' | 'other',
          payout_details_json: payoutDetailsJson,
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

      {/* Payout Method */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold">{t('sectionPayoutMethod')}</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payoutMethod">{t('labelPreferredMethod')} *</Label>
            <Select
              value={payoutMethod}
              onValueChange={(value) => {
                setPayoutMethod(value as typeof payoutMethod);
                setPayoutDetails('');
                setPayoutDetails2('');
                setPayoutDetails3('');
              }}
              disabled={isPending}
              required
            >
              <SelectTrigger id="payoutMethod">
                <SelectValue placeholder={t('placeholderSelectMethod')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">{t('optionBankTransfer')}</SelectItem>
                <SelectItem value="paypal">{t('optionPaypal')}</SelectItem>
                <SelectItem value="other">{t('optionOther')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {payoutMethod && (
            <div className="space-y-2">
              <Label htmlFor="payoutDetails">
                {payoutMethod === 'paypal'
                  ? `${t('labelPaypalEmail')} *`
                  : payoutMethod === 'bank_transfer' && bankFields
                    ? `${bankFields.label1} *`
                    : `${t('labelAccountDetails')} *`}
              </Label>
              <Input
                id="payoutDetails"
                type={payoutMethod === 'paypal' ? 'email' : 'text'}
                value={payoutDetails}
                onChange={(e) => {
                  if (payoutMethod === 'bank_transfer' && bankFields?.format1) {
                    setPayoutDetails(bankFields.format1(e.target.value));
                  } else {
                    setPayoutDetails(e.target.value);
                  }
                }}
                placeholder={
                  payoutMethod === 'paypal'
                    ? t('placeholderPaypalEmail')
                    : payoutMethod === 'bank_transfer' && bankFields
                      ? bankFields.placeholder1
                      : t('placeholderAccountDetails')
                }
                disabled={isPending}
                required
              />
              {payoutMethod === 'bank_transfer' && bankFields?.label2 && (
                <div className="mt-2 space-y-2">
                  <Label htmlFor="payoutDetails2">{bankFields.label2} *</Label>
                  <Input
                    id="payoutDetails2"
                    value={payoutDetails2}
                    onChange={(e) => {
                      setPayoutDetails2(
                        bankFields.format2 ? bankFields.format2(e.target.value) : e.target.value,
                      );
                    }}
                    placeholder={bankFields.placeholder2 || ''}
                    disabled={isPending}
                    required
                  />
                </div>
              )}
              {payoutMethod === 'bank_transfer' && bankFields?.label3 && (
                <div className="mt-2 space-y-2">
                  <Label htmlFor="payoutDetails3">{bankFields.label3} *</Label>
                  <Input
                    id="payoutDetails3"
                    value={payoutDetails3}
                    onChange={(e) => {
                      setPayoutDetails3(
                        bankFields.format3 ? bankFields.format3(e.target.value) : e.target.value,
                      );
                    }}
                    placeholder={bankFields.placeholder3 || ''}
                    disabled={isPending}
                    required
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {payoutMethod === 'paypal'
                  ? t('helperPaypal')
                  : payoutMethod === 'bank_transfer'
                    ? t('helperBankTransfer')
                    : t('helperOther')}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          {t('buttonCancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? t('buttonSaving') : t('buttonComplete')}
        </Button>
      </div>
    </form>
  );
}
