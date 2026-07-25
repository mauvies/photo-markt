'use client';

import { format } from 'date-fns';
import { ChevronDownIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { EventCoverField } from '@/components/event-cover-field';
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
  // Optional dedicated cover image (T-055). Object-URL preview + change handler
  // owned by the wizard shell (the File isn't a serializable form field).
  coverPreviewUrl: string | null;
  onCoverChange: (file: File | null) => void;
};

export function Step3Details({
  form,
  submitAttempted,
  coverPreviewUrl,
  onCoverChange,
}: Step3DetailsProps) {
  const { t } = useTranslations<NewEventT>();
  const dateInputId = useId();
  const sessionTimeId = useId();
  const sessionEndTimeId = useId();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  return (
    // Two columns on desktop: the cover image on the left, all the event data
    // on the right. Stacks (cover first) on mobile. `md:items-stretch` lets
    // the left column grow to match the height of the (taller) right column
    // of fields, so the cover box can fill it — see the left column below.
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-stretch">
      {/* Left column — optional dedicated cover/presentation image (T-055).
          Shown on the event card; falls back to the first photo when empty.
          `fill` lets the box grow to match the right column's height on desktop
          while staying compact on mobile. Shared with the edit form (T-166). */}
      <EventCoverField
        previewUrl={coverPreviewUrl}
        onCoverChange={onCoverChange}
        fill
        labels={{
          label: t('coverLabel'),
          desc: t('coverDesc'),
          infoAria: t('coverInfoAria'),
          select: t('coverSelect'),
          remove: t('coverRemove'),
        }}
      />

      {/* Right column — event details. */}
      <div className="grid gap-4">
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
                  {isInvalid && error && (
                    <p className="min-h-4 text-xs text-destructive">{error}</p>
                  )}
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
                  {isInvalid && error && (
                    <p className="min-h-4 text-xs text-destructive">{error}</p>
                  )}
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
                    <PopoverContent className="w-auto overflow-hidden p-0" align="start">
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
                  {isInvalid && error && (
                    <p className="min-h-4 text-xs text-destructive">{error}</p>
                  )}
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
                            {endError ? (
                              <p className="text-xs text-destructive">{endError}</p>
                            ) : null}
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
              eventType === 'organizer' ? (
                <form.Field
                  name="organizer_fee_per_photo"
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
                        <Label htmlFor="organizer_fee_per_photo">{t('organizerFeeLabel')}</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            $
                          </span>
                          <Input
                            id="organizer_fee_per_photo"
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
                        <p className="text-xs text-muted-foreground">{t('organizerFeeDesc')}</p>
                        {isInvalid && error && (
                          <p className="min-h-4 text-xs text-destructive">{error}</p>
                        )}
                      </div>
                    );
                  }}
                </form.Field>
              ) : (
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
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            $
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
        </div>
      </div>
    </div>
  );
}
