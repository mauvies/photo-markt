'use client';

import type { ReactFormExtendedApi } from '@tanstack/react-form';
import { format } from 'date-fns';
import { ChevronDownIcon } from 'lucide-react';
import { useId } from 'react';
import {
  activityOptions,
  activityValues,
} from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
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
import { Switch } from '@/components/ui/switch';
import { isValidSessionRange, SESSION_RANGE_ERROR } from '@/lib/format-date';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { isWatermarkConfigurable } from '@/lib/watermark-policy';
import type { FormValues } from '../edit-event-schema';
import { EventPriceField } from './event-price-field';

// biome-ignore format: keep on one line so the single lint suppression below covers all type params
// biome-ignore lint/suspicious/noExplicitAny: TanStack Form has invariant variance on all 12 generic params; using `any` avoids re-deriving exact param types from the call site
type FormInstance = ReactFormExtendedApi<FormValues, any, any, any, any, any, any, any, any, any, any, any>;

type EventFormFieldsProps = {
  form: FormInstance;
  submitAttempted: boolean;
  datePopoverOpen: boolean;
  setDatePopoverOpen: (open: boolean) => void;
  /**
   * Which field group to render (T-179): `info` = name/activity/location/date/
   * price/visibility; `settings` = watermark/collaborative + guest/approval;
   * `pricing` = the price field only, for the T-203 pricing section (the ladder
   * editor is a separate component); `all` (default) = info + settings, for the
   * full edit page.
   */
  section?: 'all' | 'info' | 'settings' | 'pricing';
  /**
   * `events.type` — immutable post-creation, so it is a prop rather than a form
   * field. Only the watermark rule reads it (T-211): organizer events are
   * always private yet keep their watermark, so the switch must not be disabled
   * for them.
   */
  eventType?: string | null;
};

export function EventFormFields({
  form,
  submitAttempted,
  datePopoverOpen,
  setDatePopoverOpen,
  section = 'all',
  eventType,
}: EventFormFieldsProps) {
  const { t } = useTranslations<Dictionary['newEvent']>();
  const dateInputId = useId();
  const sessionTimeId = useId();
  const sessionEndTimeId = useId();
  const showInfo = section !== 'settings';
  const showSettings = section !== 'info';

  return (
    <div className="space-y-4" suppressHydrationWarning>
      {showInfo && (
        <>
          {/* Row 1: Name + Activity */}
          <div className="grid gap-4 md:grid-cols-2">
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) =>
                  value.trim().length === 0 ? 'Name is required.' : undefined,
              }}
            >
              {(field) => {
                const showFeedback = submitAttempted || field.state.meta.isTouched;
                const error = showFeedback ? field.state.meta.errors?.[0] : null;
                const isInvalid = showFeedback && !field.state.meta.isValid;
                return (
                  <div>
                    <Label htmlFor="name">Name or place</Label>
                    <Input
                      id="name"
                      className="mt-2"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="Event name or place"
                      aria-invalid={isInvalid}
                      autoComplete="off"
                      suppressHydrationWarning
                    />
                    {isInvalid && error ? (
                      <p className="mt-1 text-xs text-destructive">{error}</p>
                    ) : null}
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
                    : 'Activity is required.',
              }}
            >
              {(field) => {
                const showFeedback = submitAttempted || field.state.meta.isTouched;
                const error = showFeedback ? field.state.meta.errors?.[0] : null;
                const isInvalid = showFeedback && !field.state.meta.isValid;
                return (
                  <div className="grid gap-2">
                    <Label htmlFor="activity">Activity</Label>
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
                        <SelectValue placeholder="Select an activity" />
                      </SelectTrigger>
                      <SelectContent className="w-[--radix-select-trigger-width]">
                        {activityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isInvalid && error ? (
                      <p className="text-xs text-destructive">{error}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
          </div>

          {/* Row 2: Location */}
          <form.Field name="city">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="city">Location</Label>
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
                  placeholder="Search for a location..."
                  noResultsText="No locations found"
                />
              </div>
            )}
          </form.Field>

          {/* Row 3: Date + Price per Photo. `items-start` keeps the Price cell from
          stretching to match the taller Date column (Date + Session time) — a
          stretched cell grew the price field's `.relative` box so the
          `top-1/2`-centered `$` floated below the number (T-167). Mirrors the
          create wizard's date+price row. */}
          <div className="grid items-start gap-4 md:grid-cols-2">
            <form.Field
              name="date"
              validators={{
                onChange: ({ value }) =>
                  value && value.length > 0 ? undefined : 'Date is required.',
              }}
            >
              {(field) => {
                const showFeedback = submitAttempted || field.state.meta.isTouched;
                const error = showFeedback ? field.state.meta.errors?.[0] : null;
                const isInvalid = showFeedback && !field.state.meta.isValid;
                const parsedDate = field.state.value ? new Date(field.state.value) : undefined;
                return (
                  <div className="grid gap-2">
                    <Label htmlFor={dateInputId}>Date</Label>
                    <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            'w-full justify-between rounded-md border border-input text-left font-normal',
                            !parsedDate && 'text-muted-foreground',
                          )}
                          aria-invalid={isInvalid}
                        >
                          {parsedDate ? format(parsedDate, 'PPP') : 'Select date'}
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
                    <input
                      id={dateInputId}
                      type="hidden"
                      value={field.state.value}
                      readOnly
                      suppressHydrationWarning
                    />
                    {isInvalid && error ? (
                      <p className="text-xs text-destructive">{error}</p>
                    ) : null}
                    {/* Optional manual session start + end time (T-106 start,
                        T-180 end). */}
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      <form.Field name="session_time">
                        {(timeField) => (
                          <div className="grid gap-1">
                            <Label
                              htmlFor={sessionTimeId}
                              className="text-xs text-muted-foreground"
                            >
                              Session time (optional)
                            </Label>
                            <Input
                              id={sessionTimeId}
                              type="time"
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
                              : SESSION_RANGE_ERROR,
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
                                Session end time (optional)
                              </Label>
                              <Input
                                id={sessionEndTimeId}
                                type="time"
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

            {/* Extracted (T-203) so the pricing section reuses this exact input
                instead of a second copy. */}
            <EventPriceField form={form} submitAttempted={submitAttempted} />
          </div>

          {/* Visibility Toggle */}
          <form.Field name="is_public">
            {(field) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                <div className="grid gap-1">
                  <Label htmlFor="is_public">Event Visibility</Label>
                  <p className="text-xs text-muted-foreground">
                    {field.state.value
                      ? 'Anyone can access this event'
                      : 'Only people with the share code can access'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {field.state.value ? 'Public' : 'Private'}
                  </span>
                  <Switch
                    id="is_public"
                    checked={field.state.value}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked);
                      field.handleBlur();
                      form.setFieldValue('watermark_enabled', !!checked);
                    }}
                  />
                </div>
              </div>
            )}
          </form.Field>
        </>
      )}

      {showSettings && (
        <>
          {/* Watermark Toggle — subscribed to `is_public` (T-211) so the switch
              obeys the same rule the save does. A private non-organizer event
              is already protected by its share code, so the server forces the
              watermark off; rendering an enabled switch there offered a
              preference that silently disappeared on save. `Subscribe` rather
              than the `is_public` toggle's side effect, because that side
              effect never runs on an event that was ALREADY private when the
              form opened — which is the reported case. */}
          <form.Subscribe selector={(state) => state.values.is_public}>
            {(isPublic) => {
              const configurable = isWatermarkConfigurable({ eventType, isPublic });
              return (
                <form.Field name="watermark_enabled">
                  {(field) => {
                    // Show what will be persisted, not what is held in state:
                    // the two differ exactly when the rule overrides the choice.
                    const shown = configurable && field.state.value;
                    return (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                        <div className="grid gap-1">
                          <Label htmlFor="watermark_enabled">Watermark on Photos</Label>
                          <p className="text-xs text-muted-foreground">
                            {configurable
                              ? 'Add watermark for talent users (photographers see originals)'
                              : t('watermarkPrivateNote')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {shown ? 'Enabled' : 'Disabled'}
                          </span>
                          <Switch
                            id="watermark_enabled"
                            checked={shown}
                            disabled={!configurable}
                            onCheckedChange={(checked) => {
                              field.handleChange(checked);
                              field.handleBlur();
                            }}
                          />
                        </div>
                      </div>
                    );
                  }}
                </form.Field>
              );
            }}
          </form.Subscribe>

          {/* Collaborative Toggle */}
          <form.Field name="is_collaborative">
            {(field) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                <div className="grid gap-1">
                  <Label htmlFor="is_collaborative">Collaborative Event</Label>
                  <p className="text-xs text-muted-foreground">
                    Let anyone with the share link contribute photos
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {field.state.value ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    id="is_collaborative"
                    checked={field.state.value}
                    onCheckedChange={(checked) => {
                      const wasOff = !field.state.value;
                      field.handleChange(checked);
                      field.handleBlur();
                      if (checked && wasOff) {
                        form.setFieldValue('is_public', false);
                        form.setFieldValue('watermark_enabled', false);
                        form.setFieldValue('price_per_photo', null);
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.is_collaborative}>
            {(isCollaborative) =>
              isCollaborative ? (
                <div className="grid gap-3 rounded-lg border border-dashed border-input p-3">
                  <form.Field name="allow_guest_upload">
                    {(field) => (
                      <div className="flex items-center justify-between gap-4">
                        <div className="grid gap-1">
                          <Label htmlFor="allow_guest_upload">Allow guest uploads</Label>
                          <p className="text-xs text-muted-foreground">
                            Visitors without an account can contribute photos
                          </p>
                        </div>
                        <Switch
                          id="allow_guest_upload"
                          checked={field.state.value}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked);
                            field.handleBlur();
                          }}
                        />
                      </div>
                    )}
                  </form.Field>
                  <form.Field name="require_upload_approval">
                    {(field) => (
                      <div className="flex items-center justify-between gap-4">
                        <div className="grid gap-1">
                          <Label htmlFor="require_upload_approval">Require approval</Label>
                          <p className="text-xs text-muted-foreground">
                            Hold uploads as pending until you approve them
                          </p>
                        </div>
                        <Switch
                          id="require_upload_approval"
                          checked={field.state.value}
                          onCheckedChange={(checked) => {
                            field.handleChange(checked);
                            field.handleBlur();
                          }}
                        />
                      </div>
                    )}
                  </form.Field>
                </div>
              ) : null
            }
          </form.Subscribe>
        </>
      )}
    </div>
  );
}
