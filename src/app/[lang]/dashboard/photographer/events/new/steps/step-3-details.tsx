'use client';

import { format } from 'date-fns';
import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { BundleTiersField } from '@/components/bundle-tiers-field';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocationAutocomplete } from '@/components/ui/location-autocomplete';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PLATFORM_CURRENCY_SYMBOL } from '@/lib/currency';
import { isValidSessionRange } from '@/lib/format-date';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { activityOptions, activityValues } from '../activity-options';
import type { FormValues } from '../wizard.schema';
import type { EventForm } from '../wizard-types';

type NewEventT = Dictionary['newEvent'];

type Step3DetailsProps = {
  form: EventForm;
  // True once the user attempted to advance from this step. Toggles the
  // "show errors before any field has been touched" behavior.
  submitAttempted: boolean;
  /** Bundle-pricing copy for the volume-packs editor (T-203). */
  bundleT: Dictionary['bundlePricing'];
  /** Current event type — organizer events carry no per-photo price or ladder. */
  eventType: 'solo' | 'collaborative' | 'organizer';
};

export function Step3Details({ form, submitAttempted, bundleT, eventType }: Step3DetailsProps) {
  const { t } = useTranslations<NewEventT>();
  const dateInputId = useId();
  const sessionTimeId = useId();
  const sessionEndTimeId = useId();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  return (
    // Single column of event data. T-105 put the cover image in a fixed ~20rem
    // left column here; T-210 moved it to the photos step (both actions there
    // are "pick images"), so the outer two-column grid is gone and the fields
    // use the full width — the inner rows already split into two columns on
    // desktop, which is what carries the layout now.
    <div className="grid max-w-4xl gap-2">
      <div className="grid items-start gap-2 md:grid-cols-2 md:gap-4">
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) => (value.trim().length === 0 ? t('nameRequired') : undefined),
          }}
        >
          {(field) => {
            const showFeedback = submitAttempted || field.state.meta.isTouched;
            const error = showFeedback ? field.state.meta.errors?.[0] : null;
            const isInvalid = showFeedback && !field.state.meta.isValid;
            return (
              <div>
                <Label htmlFor="name">{t('nameLabel')}</Label>
                <Input
                  id="name"
                  className="mt-2 mb-1 text-sm"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('namePlaceholder')}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                  suppressHydrationWarning
                />
                {isInvalid && error && <p className="min-h-4 text-xs text-destructive">{error}</p>}
              </div>
            );
          }}
        </form.Field>

        <form.Field
          name="activity"
          validators={{
            onChange: ({ value }) =>
              value && activityValues.includes(value as (typeof activityValues)[number])
                ? undefined
                : t('activityRequired'),
          }}
        >
          {(field) => {
            const showFeedback = submitAttempted || field.state.meta.isTouched;
            const error = showFeedback ? field.state.meta.errors?.[0] : null;
            const isInvalid = showFeedback && !field.state.meta.isValid;
            return (
              <div className="grid gap-2">
                <Label htmlFor="activity">{t('activityLabel')}</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as FormValues['activity']);
                    field.handleBlur();
                  }}
                >
                  <SelectTrigger
                    id="activity"
                    className="w-full rounded-md"
                    aria-invalid={isInvalid}
                  >
                    <SelectValue placeholder={t('activityPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent className="w-[--radix-select-trigger-width]">
                    {activityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isInvalid && error && <p className="min-h-4 text-xs text-destructive">{error}</p>}
              </div>
            );
          }}
        </form.Field>
      </div>

      <form.Field
        name="city"
        validators={{
          onChange: ({ value }) =>
            value && value.trim().length > 0 ? undefined : t('locationRequired'),
        }}
      >
        {(field) => {
          const showFeedback = submitAttempted || field.state.meta.isTouched;
          const error = showFeedback ? field.state.meta.errors?.[0] : null;
          const isInvalid = showFeedback && !field.state.meta.isValid;
          return (
            <div>
              <Label htmlFor="city">{t('locationLabel')}</Label>
              <LocationAutocomplete
                id="city"
                value={field.state.value || ''}
                onChange={(val) => field.handleChange(val)}
                onPlaceSelect={(parts) => {
                  field.handleChange(parts.city);
                  form.setFieldValue('state', parts.state);
                  form.setFieldValue('country', parts.country);
                }}
                onBlur={field.handleBlur}
                placeholder={t('locationSearchPlaceholder')}
                noResultsText={t('locationNoResults')}
                aria-invalid={isInvalid}
                className="mt-2 mb-1"
              />
              {isInvalid && error && <p className="min-h-4 text-xs text-destructive">{error}</p>}
            </div>
          );
        }}
      </form.Field>

      {/* items-start prevents the cells from stretching to the taller column.
            Without this, the organizer-fee column (which has an extra
            description paragraph) makes the date column taller and CSS Grid
            distributes the extra space across its rows, drifting the Button
            out of alignment with the Input. */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <form.Field
          name="date"
          validators={{
            onChange: ({ value }) => (value && value.length > 0 ? undefined : t('dateRequired')),
          }}
        >
          {(field) => {
            const showFeedback = submitAttempted || field.state.meta.isTouched;
            const error = showFeedback ? field.state.meta.errors?.[0] : null;
            const isInvalid = showFeedback && !field.state.meta.isValid;
            const parsedDate = field.state.value ? new Date(field.state.value) : undefined;
            return (
              <div className="grid gap-2">
                <Label htmlFor={dateInputId}>{t('dateLabel')}</Label>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id={dateInputId}
                      type="button"
                      variant="outline"
                      className={cn(
                        'w-full justify-between rounded-md border border-input text-left font-normal',
                        !parsedDate && 'text-muted-foreground',
                      )}
                      aria-invalid={isInvalid}
                    >
                      {parsedDate ? format(parsedDate, 'PPP') : t('dateSelectPlaceholder')}
                      <ChevronDownIcon className="size-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
                    align="start"
                  >
                    <Calendar
                      mode="single"
                      selected={parsedDate}
                      captionLayout="dropdown"
                      onSelect={(date) => {
                        field.handleChange(date ? format(date, 'yyyy-MM-dd') : '');
                        field.handleBlur();
                        setDatePopoverOpen(false);
                      }}
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
                {isInvalid && error && <p className="min-h-4 text-xs text-destructive">{error}</p>}
                {/* Optional manual session start + end time — separate from
                      the camera time-sync feature (T-106 start, T-180 end). */}
                <div className="mt-1 grid grid-cols-2 gap-3">
                  <form.Field name="session_time">
                    {(timeField) => (
                      <div className="grid gap-1">
                        <Label htmlFor={sessionTimeId} className="text-xs text-muted-foreground">
                          {t('sessionTimeLabel')}
                        </Label>
                        <Input
                          id={sessionTimeId}
                          type="time"
                          className="text-sm"
                          value={timeField.state.value}
                          onChange={(event) => timeField.handleChange(event.target.value)}
                          onBlur={timeField.handleBlur}
                          suppressHydrationWarning
                        />
                      </div>
                    )}
                  </form.Field>
                  <form.Field
                    name="session_end_time"
                    validators={{
                      onChangeListenTo: ['session_time'],
                      onChange: ({ value, fieldApi }) =>
                        isValidSessionRange(fieldApi.form.getFieldValue('session_time'), value)
                          ? undefined
                          : t('sessionEndTimeError'),
                    }}
                  >
                    {(endField) => {
                      const endError = endField.state.meta.isTouched
                        ? endField.state.meta.errors[0]
                        : undefined;
                      return (
                        <div className="grid gap-1">
                          <Label
                            htmlFor={sessionEndTimeId}
                            className="text-xs text-muted-foreground"
                          >
                            {t('sessionEndTimeLabel')}
                          </Label>
                          <Input
                            id={sessionEndTimeId}
                            type="time"
                            className="text-sm"
                            value={endField.state.value}
                            onChange={(event) => endField.handleChange(event.target.value)}
                            onBlur={endField.handleBlur}
                            suppressHydrationWarning
                          />
                          {endError ? <p className="text-xs text-destructive">{endError}</p> : null}
                        </div>
                      );
                    }}
                  </form.Field>
                </div>
              </div>
            );
          }}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.event_type}>
          {(eventType) =>
            // T-219: an organizer event stores `price_per_photo: null` — each
            // contributor sells their own photos — so it gets no price input at
            // all. The fee-per-photo field that used to sit here was collected
            // and applied by no money path, and its copy promised organizers a
            // cut that never moved. Removed until the revenue split is real.
            eventType === 'organizer' ? null : (
              <form.Field
                name="price_per_photo"
                validators={{
                  onChange: ({ value }) => {
                    if (value === undefined || value === null) return undefined;
                    const num = typeof value === 'string' ? Number.parseFloat(value) : value;
                    if (Number.isNaN(num)) return t('priceInvalidNumber');
                    if (num < 0) return t('priceNegative');
                    return undefined;
                  },
                }}
              >
                {(field) => {
                  const showFeedback = submitAttempted || field.state.meta.isTouched;
                  const error = showFeedback ? field.state.meta.errors?.[0] : null;
                  const isInvalid = showFeedback && !field.state.meta.isValid;
                  return (
                    <div className="grid gap-2">
                      <Label htmlFor="price_per_photo">{t('priceLabel')}</Label>
                      <div className="relative">
                        {/* T-203: was a hardcoded `$` while checkout charges in
                              EUR — a leftover the T-193 currency migration missed. */}
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
                          className="pl-7 text-sm"
                          suppressHydrationWarning
                        />
                      </div>
                      {isInvalid && error && (
                        <p className="min-h-4 text-xs text-destructive">{error}</p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            )
          }
        </form.Subscribe>

        {/* Volume pricing (T-203) — a THIRD child of this 2-column row with
              `md:col-start-2`, so on desktop it sits directly beneath the price
              input in the same column instead of drifting into the cover column,
              and on mobile it stacks right after the price. Grouping it with the
              price is the point: they are one decision.
              Nested Fields so the editor sees the LIVE price as it is typed.
              Organizer events carry no ladder and no price of their own: several
              contributors sell into one event, so there is no agreed way to
              apportion a discount (T-219). */}
        {eventType === 'organizer' ? null : (
          <div className="md:col-start-2">
            <form.Field name="price_per_photo">
              {(priceField) => (
                <form.Field name="bundle_tiers">
                  {(tiersField) => {
                    const raw: unknown = priceField.state.value;
                    const price =
                      typeof raw === 'number' && Number.isFinite(raw)
                        ? raw
                        : typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))
                          ? Number(raw)
                          : null;
                    return (
                      <form.Field name="bundle_all_photos_cents">
                        {(capField) => (
                          <BundleTiersField
                            value={tiersField.state.value}
                            onChange={tiersField.handleChange}
                            allPhotosCents={capField.state.value}
                            onAllPhotosChange={capField.handleChange}
                            pricePerPhoto={price}
                            eventType={eventType}
                            t={bundleT}
                          />
                        )}
                      </form.Field>
                    );
                  }}
                </form.Field>
              )}
            </form.Field>
          </div>
        )}
      </div>
    </div>
  );
}
