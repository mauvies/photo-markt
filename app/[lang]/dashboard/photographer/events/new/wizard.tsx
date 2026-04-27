'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { ChevronDownIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import { DashboardHeader } from '@/components/dashboard-header';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { cn } from '@/lib/utils';
import { createEvent } from './actions';
import { activityOptions, activityValues } from './activity-options';
import { ConfirmEventDialog } from './components/confirm-event-dialog';
import { PhotoUploadSection } from './components/photo-upload-section';
import { ShareCodeDialog } from './components/share-code-dialog';
import { eventSchema, type FormValues } from './wizard.schema';

type NewEventT = Dictionary['newEvent'];

const STORAGE_KEY = 'photo-markt_new_event_form';
const LEGACY_STORAGE_KEY = 'picdemi_new_event_form';

const getDefaultValues = (): FormValues => {
  if (typeof window === 'undefined') {
    return {
      name: '',
      activity: 'OTHER',
      date: '',
      country: '',
      state: '',
      city: '',
      is_public: true,
      watermark_enabled: true,
      price_per_photo: null,
    };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (localStorage.getItem(STORAGE_KEY) === null) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      return {
        name: parsed.name || '',
        activity: parsed.activity || 'OTHER',
        date: parsed.date || '',
        country: '',
        state: '',
        city: parsed.city || '',
        is_public: parsed.is_public ?? true,
        watermark_enabled: parsed.watermark_enabled ?? true,
        price_per_photo: parsed.price_per_photo ?? null,
      };
    }
  } catch {
    // Ignore parse errors
  }

  return {
    name: '',
    activity: 'OTHER',
    date: '',
    country: '',
    state: '',
    city: '',
    is_public: true,
    watermark_enabled: true,
    price_per_photo: null,
  };
};

const defaultValues = getDefaultValues();

export default function NewEventForm() {
  const { t } = useTranslations<NewEventT>();
  const router = useRouter();
  const lp = useLocalizedPath();
  const [files, setFiles] = useState<File[]>([]);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [createdShareCode, setCreatedShareCode] = useState<string | null>(null);
  const [createdEventName, setCreatedEventName] = useState<string | null>(null);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const dateInputId = useId();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Array<{ id: string; url: string; file: File }>>(
    [],
  );

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const parsed = eventSchema.parse(value);
        if (files.length === 0) {
          setPhotosError(t('photosRequired'));
          return;
        }
        setPhotosError(null);
        setSubmitError(null);
        setPendingValues(parsed);
        setIsModalOpen(true);
        setSubmitAttempted(false);
      } catch (error) {
        console.error(error);
      }
    },
  });

  // Save to localStorage whenever form values change
  useEffect(() => {
    const values = form.state.values;
    const hasData = values.name || values.activity || values.date || values.city;
    if (hasData) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
      } catch {
        // Ignore storage errors
      }
    }
  }, [form.state.values]);

  // Generate preview URLs for files
  useEffect(() => {
    const previews = files.map((file) => ({
      id: `preview-${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      file,
    }));
    setFilePreviews(previews);

    return () => {
      // Cleanup object URLs
      previews.forEach((preview) => {
        URL.revokeObjectURL(preview.url);
      });
    };
  }, [files]);

  const handleFiles = (incoming: File[]) => {
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const exists = next.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified,
        );
        if (!exists) next.push(file);
      }
      return next;
    });
    if (incoming.length > 0) {
      setPhotosError(null);
    }
  };

  const removeFile = (targetFile: File) => {
    setFiles((prev) => {
      const next = prev.filter((file) => file !== targetFile);
      if (submitAttempted && next.length === 0) {
        setPhotosError(t('photosRequired'));
      } else if (next.length > 0) {
        setPhotosError(null);
      }
      return next;
    });
  };

  const confirmCreation = () => {
    const value = pendingValues;
    if (!value || isPending) return;
    if (files.length === 0) {
      setPhotosError(t('photosRequired'));
      setIsModalOpen(false);
      return;
    }
    const formData = new FormData();
    formData.append('name', value.name.trim());
    formData.append('activity', value.activity);
    formData.append('date', value.date);
    if (value.city?.trim()) {
      formData.append('city', value.city.trim());
    }
    formData.append('is_public', value.is_public ? 'true' : 'false');
    formData.append('watermark_enabled', value.watermark_enabled ? 'true' : 'false');
    if (value.price_per_photo !== undefined && value.price_per_photo !== null) {
      const price =
        typeof value.price_per_photo === 'string'
          ? Number.parseFloat(value.price_per_photo)
          : value.price_per_photo;
      if (!Number.isNaN(price) && price >= 0) {
        formData.append('price_per_photo', price.toString());
      }
    }
    for (const file of files) {
      formData.append('photos', file);
    }

    startTransition(async () => {
      try {
        const result = await createEvent(formData);
        if (!result?.eventId) {
          throw new Error('Event could not be created');
        }
        setSubmitError(null);
        setIsModalOpen(false);
        // Clear localStorage on success
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Ignore storage errors
        }
        // If event is private, show share code before redirecting
        if (!value.is_public && result.shareCode) {
          setCreatedShareCode(result.shareCode);
          setCreatedEventName(value.name);
          setCreatedEventId(result.eventId);
          // Redirect after a short delay to show the share code
          setTimeout(() => {
            router.push(lp(`/dashboard/photographer/events/${result.eventId}`));
          }, 5000);
        } else {
          router.push(lp(`/dashboard/photographer/events/${result.eventId}`));
        }
      } catch (error) {
        console.error(error);
        setSubmitError(error instanceof Error ? error.message : t('submitError'));
      }
    });
  };

  const eventSummary = useMemo(() => {
    const source = pendingValues ?? form.state.values;
    const price =
      source.price_per_photo !== null && source.price_per_photo !== undefined
        ? `$${typeof source.price_per_photo === 'string' ? Number.parseFloat(source.price_per_photo).toFixed(2) : source.price_per_photo.toFixed(2)}`
        : t('summaryFree');

    return [
      { label: t('summaryName'), value: source.name },
      {
        label: t('summaryActivity'),
        value:
          activityOptions.find((option) => option.value === source.activity)?.label ??
          source.activity,
      },
      {
        label: t('summaryDate'),
        value: source.date ? format(new Date(source.date), 'PPP') : '',
      },
      ...(source.city ? [{ label: t('summaryLocation'), value: source.city }] : []),
      {
        label: t('summaryVisibility'),
        value: source.is_public ? t('summaryPublic') : t('summaryPrivate'),
      },
      {
        label: t('summaryWatermark'),
        value:
          source.is_public && source.watermark_enabled ? t('summaryEnabled') : t('summaryDisabled'),
      },
      { label: t('summaryPrice'), value: price },
      { label: 'Photos', value: t('summaryPhotosCount').replace('{n}', String(files.length)) },
    ];
  }, [pendingValues, form.state.values, files.length, t]);

  return (
    <div>
      <div className="mx-auto w-full max-w-full space-y-6">
        <header>
          <DashboardHeader title={t('title')} />
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>

        {/* Unified layout: Desktop split, Mobile stacked */}
        <div className="grid min-w-0 gap-6 lg:grid-cols-2 lg:items-stretch">
          {/* Form section - left side on desktop */}
          <div className="order-2 min-w-0 w-full lg:sticky lg:top-4">
            <form
              className="flex h-full flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitAttempted(true);
                form.handleSubmit();
              }}
              noValidate
              suppressHydrationWarning
            >
              <div className="grid gap-2" suppressHydrationWarning>
                {/* Row 1: Name + Activity (paired on desktop) */}
                <div className="grid gap-2 md:gap-4 md:grid-cols-2">
                  <form.Field
                    name="name"
                    validators={{
                      onChange: ({ value }) =>
                        value.trim().length === 0 ? t('nameRequired') : undefined,
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
                            className="mt-2 mb-1"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                            placeholder={t('namePlaceholder')}
                            aria-invalid={isInvalid}
                            autoComplete="off"
                            suppressHydrationWarning
                          />
                          <p className="min-h-4 text-xs text-destructive">
                            {isInvalid ? error : ''}
                          </p>
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
                          <p className="min-h-4 text-xs text-destructive">
                            {isInvalid ? error : ''}
                          </p>
                        </div>
                      );
                    }}
                  </form.Field>
                </div>

                {/* Row 2: Location */}
                <form.Field name="city">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor="city">{t('locationLabel')}</Label>
                      <Input
                        id="city"
                        value={field.state.value || ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('locationPlaceholder')}
                        autoComplete="off"
                        suppressHydrationWarning
                      />
                    </div>
                  )}
                </form.Field>

                {/* Row 3: Date + Price per Photo (paired on desktop) */}
                <div className="mt-1.5 grid gap-4 md:grid-cols-2">
                  <form.Field
                    name="date"
                    validators={{
                      onChange: ({ value }) =>
                        value && value.length > 0 ? undefined : t('dateRequired'),
                    }}
                  >
                    {(field) => {
                      const showFeedback = submitAttempted || field.state.meta.isTouched;
                      const error = showFeedback ? field.state.meta.errors?.[0] : null;
                      const isInvalid = showFeedback && !field.state.meta.isValid;
                      const parsedDate = field.state.value
                        ? new Date(field.state.value)
                        : undefined;
                      return (
                        <div className="grid gap-2">
                          <Label htmlFor={dateInputId}>{t('dateLabel')}</Label>
                          <div>
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
                                  {parsedDate
                                    ? format(parsedDate, 'PPP')
                                    : t('dateSelectPlaceholder')}
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
                                  initialFocus
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
                            <p className="mt-1 min-h-4 text-xs text-destructive">
                              {isInvalid ? error : ''}
                            </p>
                          </div>
                        </div>
                      );
                    }}
                  </form.Field>

                  <form.Field
                    name="price_per_photo"
                    validators={{
                      onChange: ({ value }) => {
                        if (value === undefined || value === null) {
                          return undefined; // Optional field
                        }
                        const num = typeof value === 'string' ? Number.parseFloat(value) : value;
                        if (Number.isNaN(num)) {
                          return t('priceInvalidNumber');
                        }
                        if (num < 0) {
                          return t('priceNegative');
                        }
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
                              className="pl-7"
                              suppressHydrationWarning
                            />
                          </div>
                          <p className="min-h-4 text-xs text-destructive">
                            {isInvalid ? error : ''}
                          </p>
                        </div>
                      );
                    }}
                  </form.Field>
                </div>

                <form.Field name="is_public">
                  {(field) => {
                    return (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                        <div className="grid gap-1">
                          <Label htmlFor="is_public">{t('visibilityLabel')}</Label>
                          <p className="text-xs text-muted-foreground">
                            {field.state.value
                              ? t('visibilityPublicDesc')
                              : t('visibilityPrivateDesc')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {field.state.value ? t('visibilityPublic') : t('visibilityPrivate')}
                          </span>
                          <Switch
                            id="is_public"
                            checked={field.state.value}
                            onCheckedChange={(checked) => {
                              field.handleChange(checked);
                              field.handleBlur();
                              // Auto-toggle watermark based on visibility
                              if (checked) {
                                // Enable watermark when making event public
                                form.setFieldValue('watermark_enabled', true);
                              } else {
                                // Disable watermark when making event private
                                form.setFieldValue('watermark_enabled', false);
                              }
                            }}
                          />
                        </div>
                      </div>
                    );
                  }}
                </form.Field>

                <form.Field name="watermark_enabled">
                  {(field) => {
                    return (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                        <div className="grid gap-1">
                          <Label htmlFor="watermark_enabled">{t('watermarkLabel')}</Label>
                          <p className="text-xs text-muted-foreground">{t('watermarkDesc')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {field.state.value ? t('watermarkEnabled') : t('watermarkDisabled')}
                          </span>
                          <Switch
                            id="watermark_enabled"
                            checked={field.state.value}
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
              </div>
            </form>
          </div>

          <PhotoUploadSection
            previews={filePreviews}
            error={photosError}
            onFiles={handleFiles}
            onRemove={removeFile}
          />
        </div>

        {/* Fixed Action Buttons - Bottom */}
        <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80 md:bottom-0 md:left-(--sidebar-width)">
          <div className="mx-auto flex w-full max-w-full flex-col items-end gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
            {submitError ? (
              <p className="text-sm text-destructive text-right sm:text-left">{submitError}</p>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isPending}
              >
                {t('cancelButton')}
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setSubmitAttempted(true);
                  form.handleSubmit();
                }}
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t('creatingButton')}
                  </>
                ) : (
                  t('createButton')
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmEventDialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        summary={eventSummary}
        isPending={isPending}
        onConfirm={confirmCreation}
      />

      {createdShareCode && createdEventName && (
        <ShareCodeDialog
          shareCode={createdShareCode}
          eventName={createdEventName}
          onGoToEvent={() => {
            if (createdEventId) {
              setCreatedShareCode(null);
              setCreatedEventName(null);
              setCreatedEventId(null);
              router.push(lp(`/dashboard/photographer/events/${createdEventId}`));
            }
          }}
        />
      )}
    </div>
  );
}
