'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { PaymentAccount, PaymentAccountType } from '@/database/queries/payment-accounts';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  type BankAccountFields,
  COMMON_COUNTRIES,
  getBankAccountFields,
} from './bank-account-fields';
import {
  createPaymentAccountAction,
  deletePaymentAccountAction,
  getPaymentAccountsAction,
  getPhotographerCountryAction,
  setDefaultPaymentAccountAction,
} from './payment-accounts-actions';

type EarningsT = Dictionary['earnings'];
type TFn = (key: keyof EarningsT) => string;

function getPaymentTypeLabel(type: PaymentAccountType, t: TFn): string {
  switch (type) {
    case 'bank_account':
      return t('bankAccount');
    case 'paypal':
      return t('paypal');
    case 'wise':
      return t('wise');
    case 'other':
      return t('other');
    default:
      return type;
  }
}

function formatAccountDetails(account: PaymentAccount, t: TFn): string {
  if (account.type === 'paypal' || account.type === 'wise') {
    const email = account.account_details?.email as string | undefined;
    return email || t('notProvided');
  }
  if (account.type === 'bank_account') {
    const bankName = account.account_details?.bank_name as string | undefined;
    const last4 = account.account_details?.account_number_last4 as string | undefined;
    const country = account.account_details?.country_code as string | undefined;
    const countryName = COMMON_COUNTRIES.find((c) => c.code === country)?.name || country;
    if (bankName && last4) {
      return `${bankName} ••••${last4}${countryName ? ` (${countryName})` : ''}`;
    }
    return `${t('bankAccountFallback')}${countryName ? ` (${countryName})` : ''}`;
  }
  return t('accountDetailsFallback');
}

interface PaymentAccountFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: PaymentAccount;
}

function PaymentAccountForm({ onSuccess, onCancel, initialData }: PaymentAccountFormProps) {
  const { t } = useTranslations<EarningsT>();
  const [type, setType] = useState<PaymentAccountType>(initialData?.type ?? 'bank_account');
  const [displayName, setDisplayName] = useState(initialData?.display_name ?? '');
  const [accountHolderName, setAccountHolderName] = useState(
    initialData?.account_holder_name ?? '',
  );
  const [countryCode, setCountryCode] = useState<string>(
    (initialData?.account_details?.country_code as string) ?? '',
  );
  const [isLoadingCountry, setIsLoadingCountry] = useState(!initialData);

  // Load photographer's country from profile if not provided
  useEffect(() => {
    if (!initialData && !countryCode && type === 'bank_account') {
      getPhotographerCountryAction()
        .then((country) => {
          if (country) {
            setCountryCode(country);
          }
          setIsLoadingCountry(false);
        })
        .catch(() => {
          setIsLoadingCountry(false);
        });
    } else {
      setIsLoadingCountry(false);
    }
  }, [initialData, countryCode, type]);
  const [email, setEmail] = useState((initialData?.account_details?.email as string) ?? '');
  const [bankName, setBankName] = useState(
    (initialData?.account_details?.bank_name as string) ?? '',
  );
  const [field1, setField1] = useState('');
  const [field2, setField2] = useState('');
  const [field3, setField3] = useState('');
  const [otherDetails, setOtherDetails] = useState(
    (initialData?.account_details?.other as string) ?? '',
  );
  const [isDefault, setIsDefault] = useState(initialData?.is_default ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Get bank account fields based on country
  const bankFields: BankAccountFields = getBankAccountFields(countryCode);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError(t('errorDisplayNameRequired'));
      return;
    }

    let accountDetails: Record<string, unknown> = {};

    if (type === 'paypal' || type === 'wise') {
      if (!email.trim()) {
        setError(t('errorEmailRequired'));
        return;
      }
      accountDetails = { email: email.trim() };
    } else if (type === 'bank_account') {
      if (!countryCode) {
        setError(t('errorCountryRequired'));
        return;
      }
      if (!bankName.trim()) {
        setError(t('errorBankNameRequired'));
        return;
      }
      if (!field1.trim()) {
        setError(`${bankFields.label1} ${t('errorFieldRequired')}`);
        return;
      }
      if (bankFields.label2 && !field2.trim()) {
        setError(`${bankFields.label2} ${t('errorFieldRequired')}`);
        return;
      }
      if (bankFields.label3 && !field3.trim()) {
        setError(`${bankFields.label3} ${t('errorFieldRequired')}`);
        return;
      }

      // Store account details based on country format
      const details: Record<string, unknown> = {
        bank_name: bankName.trim(),
        country_code: countryCode,
      };

      if (bankFields.label1 === 'IBAN') {
        // For IBAN, store the full IBAN (we'll mask it in display)
        details.iban = field1.trim().replace(/\s/g, '');
        const accountNum = field1.slice(-4); // Last 4 chars for display
        details.account_number_last4 = accountNum;
      } else {
        // For other formats, store field values
        details[bankFields.label1.toLowerCase().replace(/\s/g, '_')] = field1.trim();
        if (bankFields.label2) {
          const accountNum = field2.trim();
          details.account_number_last4 = accountNum.slice(-4);
          details[bankFields.label2.toLowerCase().replace(/\s/g, '_')] = accountNum;
        }
        if (bankFields.label3) {
          details[bankFields.label3.toLowerCase().replace(/\s/g, '_')] = field3.trim();
        }
      }

      accountDetails = details;
    } else {
      accountDetails = { other: otherDetails.trim() };
    }

    startTransition(async () => {
      try {
        await createPaymentAccountAction({
          type,
          display_name: displayName.trim(),
          account_holder_name: accountHolderName.trim() || null,
          account_details: accountDetails,
          is_default: isDefault,
        });
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorFailedCreateAccount'));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="type">{t('paymentMethod')}</Label>
          <Select value={type} onValueChange={(value) => setType(value as PaymentAccountType)}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank_account">{t('bankAccount')}</SelectItem>
              <SelectItem value="paypal">{t('paypal')}</SelectItem>
              <SelectItem value="wise">{t('wise')}</SelectItem>
              <SelectItem value="other">{t('other')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName">{t('displayNameLabel')} *</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('displayNamePlaceholder')}
            disabled={isPending}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="accountHolderName">{t('accountHolderNameLabel')}</Label>
          <Input
            id="accountHolderName"
            value={accountHolderName}
            onChange={(e) => setAccountHolderName(e.target.value)}
            placeholder={t('accountHolderNamePlaceholder')}
            disabled={isPending}
          />
        </div>

        {(type === 'paypal' || type === 'wise') && (
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')} *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              disabled={isPending}
              required
            />
          </div>
        )}

        {type === 'bank_account' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="countryCode">{t('countryLabel')} *</Label>
              <Select
                value={countryCode}
                onValueChange={(value) => {
                  setCountryCode(value);
                  setField1('');
                  setField2('');
                  setField3('');
                }}
                disabled={isPending || isLoadingCountry}
              >
                <SelectTrigger id="countryCode">
                  <SelectValue
                    placeholder={isLoadingCountry ? t('loadingCountry') : t('selectCountry')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {countryCode && !initialData && (
                <p className="text-xs text-muted-foreground">{t('usingCountryFromProfile')}</p>
              )}
            </div>
            {countryCode && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="bankName">{t('bankNameLabel')} *</Label>
                  <Input
                    id="bankName"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder={t('bankNamePlaceholder')}
                    disabled={isPending}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="field1">{bankFields.label1} *</Label>
                  <Input
                    id="field1"
                    type="text"
                    value={field1}
                    onChange={(e) => {
                      const formatted = bankFields.format1
                        ? bankFields.format1(e.target.value)
                        : e.target.value;
                      setField1(formatted);
                    }}
                    placeholder={bankFields.placeholder1}
                    disabled={isPending}
                    required
                  />
                </div>
                {bankFields.label2 && (
                  <div className="space-y-2">
                    <Label htmlFor="field2">{bankFields.label2} *</Label>
                    <Input
                      id="field2"
                      type="text"
                      value={field2}
                      onChange={(e) => {
                        const formatted = bankFields.format2
                          ? bankFields.format2(e.target.value)
                          : e.target.value;
                        setField2(formatted);
                      }}
                      placeholder={bankFields.placeholder2 || ''}
                      disabled={isPending}
                      required
                    />
                  </div>
                )}
                {bankFields.label3 && (
                  <div className="space-y-2">
                    <Label htmlFor="field3">{bankFields.label3} *</Label>
                    <Input
                      id="field3"
                      type="text"
                      value={field3}
                      onChange={(e) => {
                        const formatted = bankFields.format3
                          ? bankFields.format3(e.target.value)
                          : e.target.value;
                        setField3(formatted);
                      }}
                      placeholder={bankFields.placeholder3 || ''}
                      disabled={isPending}
                      required
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {type === 'other' && (
          <div className="space-y-2">
            <Label htmlFor="otherDetails">{t('accountDetailsLabel')}</Label>
            <Textarea
              id="otherDetails"
              value={otherDetails}
              onChange={(e) => setOtherDetails(e.target.value)}
              placeholder={t('accountDetailsPlaceholder')}
              disabled={isPending}
            />
          </div>
        )}

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="isDefault"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 rounded border-gray-300"
          />
          <Label htmlFor="isDefault" className="text-sm font-normal">
            {t('setAsDefaultCheckbox')}
          </Label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? t('saving') : t('saveAccount')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PaymentAccountsSection() {
  const { t } = useTranslations<EarningsT>();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { data: accounts = [], isPending: isLoading } = useQuery({
    queryKey: ['payment-accounts'] as const,
    queryFn: () => getPaymentAccountsAction(),
    staleTime: 2 * 60 * 1000,
  });

  const handleDelete = async (accountId: string) => {
    if (!confirm(t('deleteAccountConfirm'))) {
      return;
    }

    startTransition(async () => {
      try {
        await deletePaymentAccountAction(accountId);
        queryClient.invalidateQueries({ queryKey: ['payment-accounts'] });
      } catch (error) {
        console.error('Failed to delete payment account:', error);
        alert(error instanceof Error ? error.message : t('failedDeleteAccount'));
      }
    });
  };

  const handleSetDefault = async (accountId: string) => {
    startTransition(async () => {
      try {
        await setDefaultPaymentAccountAction(accountId);
        queryClient.invalidateQueries({ queryKey: ['payment-accounts'] });
      } catch (error) {
        console.error('Failed to set default account:', error);
        alert(error instanceof Error ? error.message : t('failedSetDefault'));
      }
    });
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('paymentAccountsTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('paymentAccountsDesc')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('addAccount')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('addPaymentAccountTitle')}</DialogTitle>
              <DialogDescription>{t('addPaymentAccountDesc')}</DialogDescription>
            </DialogHeader>
            <PaymentAccountForm
              onSuccess={() => {
                setIsDialogOpen(false);
                queryClient.invalidateQueries({ queryKey: ['payment-accounts'] });
              }}
              onCancel={() => setIsDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <CreditCard className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('noPaymentAccountsYet')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-lg border bg-background p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{account.display_name}</p>
                  {account.is_default && (
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('defaultBadge')}
                    </span>
                  )}
                  {!account.is_verified && (
                    <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      {t('unverifiedBadge')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getPaymentTypeLabel(account.type, t)} • {formatAccountDetails(account, t)}
                </p>
                {account.account_holder_name && (
                  <p className="text-xs text-muted-foreground">{account.account_holder_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!account.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(account.id)}
                    disabled={isPending}
                    title={t('setAsDefault')}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(account.id)}
                  disabled={isPending}
                  title={t('deleteAccount')}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
