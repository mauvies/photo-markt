'use client';

import type { ReactFormExtendedApi } from '@tanstack/react-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { FormValues } from '../edit-event-schema';

// biome-ignore format: keep on one line so the single lint suppression below covers all type params
// biome-ignore lint/suspicious/noExplicitAny: TanStack Form has invariant variance on all 12 generic params; using `any` avoids re-deriving exact param types from the call site
type FormInstance = ReactFormExtendedApi<FormValues, any, any, any, any, any, any, any, any, any, any, any>;

interface EventPriceFieldProps {
  form: FormInstance;
  submitAttempted: boolean;
}

/**
 * The event's single-photo price input.
 *
 * Extracted from `EventFormFields` (T-203) so the `info` section and the new
 * `pricing` section render the SAME input instead of two copies that can drift —
 * the ladder editor sits directly beside it, and its per-photo readouts are only
 * meaningful next to the unit price they discount.
 *
 * The currency prefix reads from `PLATFORM_CURRENCY_SYMBOL`. It was a hardcoded
 * `$` until this extraction, which contradicted the EUR migration (T-193) that
 * converted every other money surface — the input said `$` while checkout
 * charged in euros.
 *
 * The label reads from the dictionary (T-213). The extraction had left it as a
 * hardcoded English string behind an optional `label` prop that no call site
 * passed, so a Spanish photographer saw "Price per Photo (Optional)" sitting
 * next to fully translated `bundlePricing` copy. Both call sites render inside
 * the `dict.newEvent` provider, which already owns this exact string for the
 * create wizard's price input — so the two surfaces now share one source
 * instead of a translated one and an English one.
 */
export function EventPriceField({ form, submitAttempted }: EventPriceFieldProps) {
  const { t } = useTranslations<Dictionary['newEvent']>();
  return (
    <form.Field
      name="price_per_photo"
      validators={{
        onChange: ({ value }: { value: unknown }) => {
          if (value === undefined || value === null) {
            return undefined;
          }
          const num = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
          if (Number.isNaN(num)) {
            return 'Price must be a valid number.';
          }
          if (num < 0) {
            return 'Price cannot be negative.';
          }
          return undefined;
        },
      }}
    >
      {(field: {
        state: {
          value: number | string | null | undefined;
          meta: { isTouched: boolean; isValid: boolean; errors?: unknown[] };
        };
        handleChange: (value: number | null) => void;
        handleBlur: () => void;
      }) => {
        const showFeedback = submitAttempted || field.state.meta.isTouched;
        const error = showFeedback ? (field.state.meta.errors?.[0] as string | undefined) : null;
        const isInvalid = showFeedback && !field.state.meta.isValid;
        return (
          <div className="grid gap-2">
            <Label htmlFor="price_per_photo">{t('priceLabel')}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {PLATFORM_CURRENCY_SYMBOL}
              </span>
              <Input
                id="price_per_photo"
                type="number"
                step="0.01"
                min="0"
                value={
                  field.state.value === null || field.state.value === undefined
                    ? ''
                    : typeof field.state.value === 'string'
                      ? field.state.value
                      : field.state.value.toString()
                }
                onChange={(event) => {
                  const val = event.target.value;
                  if (val === '') {
                    field.handleChange(null);
                  } else {
                    const num = Number.parseFloat(val);
                    if (!Number.isNaN(num)) {
                      field.handleChange(num);
                    } else {
                      field.handleChange(val as unknown as number);
                    }
                  }
                }}
                onBlur={field.handleBlur}
                placeholder="0.00"
                aria-invalid={isInvalid}
                // `text-sm` matches the create wizard's price input so the
                // currency prefix and the value share one line-height (T-167).
                className="pl-7 text-sm"
                suppressHydrationWarning
              />
            </div>
            {isInvalid && error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        );
      }}
    </form.Field>
  );
}
