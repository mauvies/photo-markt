'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { BundleTiersField } from '@/components/bundle-tiers-field';
import { Button } from '@/components/ui/button';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { parseAllPhotosCents, parseBundleTiers } from '@/lib/bundle-pricing';
import { bundleScheduleErrorText } from '@/lib/bundle-schedule-error';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { minPhotoPriceMessage } from '@/lib/min-photo-price';
import { eventTabForScopedSection, type ScopedEditSection } from '../event-tab';
import { updateEventAction } from './actions';
import { EventAiSettingsFields } from './components/event-ai-settings-fields';
import { EventFormFields } from './components/event-form-fields';
import { EventPriceField } from './components/event-price-field';
import { eventSchema, type FormValues } from './edit-event-schema';
import { buildEventUpdateFormData } from './event-form-data';

type ScopedSection = ScopedEditSection;

type ScopedEventEditFormProps = {
  event: Event;
  section: ScopedSection;
  labels: { save: string; saving: string; cancel: string };
  /** Bundle-pricing copy — required for the `pricing` section (T-203). */
  bundleT?: Dictionary['bundlePricing'];
};

/**
 * Section-scoped event edit form (T-179). Renders ONLY one card's worth of
 * fields — `info` (name/activity/location/date/price/visibility) or `settings`
 * (watermark/collaborative + guest/approval + AI/reveal/bib/minors) — so editing
 * is localized and simpler than the full edit page. It still initializes every
 * field from the current event and submits the whole payload via
 * `updateEventAction`, so the unedited fields ride along unchanged and all the
 * server-side cross-field invariants stay intact. Photos/cover are untouched
 * here (managed on the full edit page + the Photos tab).
 */
export function ScopedEventEditForm({ event, section, labels, bundleT }: ScopedEventEditFormProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  const eventDate = event.date ? format(new Date(event.date), 'yyyy-MM-dd') : '';
  const eventSessionTime = event.session_time?.slice(0, 5);
  const record = event as unknown as Record<string, unknown>;
  const eventSessionEndTime = (record.session_end_time as string | null | undefined)?.slice(0, 5);

  const defaultValues: FormValues = {
    name: event.name,
    activity: event.activity as FormValues['activity'],
    date: eventDate,
    session_time: eventSessionTime ?? '',
    session_end_time: eventSessionEndTime ?? '',
    city: event.city,
    state: event.state ?? '',
    country: event.country ?? '',
    is_public: event.is_public,
    watermark_enabled: event.watermark_enabled,
    is_collaborative: event.is_collaborative,
    allow_guest_upload: event.allow_guest_upload,
    require_upload_approval: event.require_upload_approval,
    price_per_photo: event.price_per_photo,
    ai_matching_enabled: Boolean(record.ai_matching_enabled),
    contains_minors: Boolean(record.contains_minors),
    bib_detection_enabled: Boolean(record.bib_detection_enabled),
    reveal_gate_enabled: Boolean(record.reveal_gate_enabled),
    // Seeds the pricing section's editor. Other sections no longer SEND this
    // (T-212), so a ladder the read parser rejects is round-tripped by silence
    // rather than by echoing a value that could not represent it.
    bundle_tiers: parseBundleTiers(record.bundle_tiers),
    bundle_all_photos_cents: parseAllPhotosCents(record.bundle_all_photos_cents),
  };

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const parsed = eventSchema.parse(value);
        setSubmitError(null);
        // Only the pricing section renders the ladder editor, so only it may
        // speak about the ladder (T-212). The others stay silent and the action
        // leaves the stored columns untouched.
        const formData = buildEventUpdateFormData(parsed, {
          includeBundlePricing: section === 'pricing',
        });
        startTransition(async () => {
          try {
            const result = await updateEventAction(event.id, formData);
            if (!result?.success) return;
            // Land on the tab that DISPLAYS what was just edited (T-213) —
            // `details` renders no price, so a pricing save used to look like
            // it had done nothing.
            const tab = eventTabForScopedSection(section);
            router.push(lp(`/dashboard/photographer/events/${event.id}?tab=${tab}`));
          } catch (error) {
            console.error(error);
            // T-195: render the price-floor sentinel as prose. This form has no
            // dictionary (like its sibling `event-form-fields`), so the copy is
            // English here — matching the file's existing convention.
            const minPrice = minPhotoPriceMessage(error, 'Price per photo must be at least {min}.');
            // T-203: a rejected ladder arrives as the `BUNDLE_TIERS:` sentinel.
            // Unlike the surrounding English strings this one IS localized —
            // the pricing section receives the dictionary block, so there is no
            // reason to degrade it.
            const bundleError = bundleT
              ? bundleScheduleErrorText(error, {
                  ...bundleT.errors,
                  fallback: bundleT.errors.fallback,
                })
              : null;
            setSubmitError(
              minPrice ??
                bundleError ??
                (error instanceof Error
                  ? error.message
                  : 'Something went wrong. Please try again.'),
            );
          }
        });
      } catch (error) {
        console.error(error);
        if (error instanceof z.ZodError) {
          setSubmitError(error.issues[0]?.message ?? 'Invalid form data');
        }
      }
    },
  });

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitAttempted(true);
        form.handleSubmit();
      }}
      noValidate
      suppressHydrationWarning
    >
      {submitError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {submitError}
        </div>
      )}

      {/* The pricing section renders only the price field + ladder editor, so it
          skips the info/settings field groups entirely. */}
      {section === 'pricing' ? null : (
        <EventFormFields
          form={form}
          submitAttempted={submitAttempted}
          datePopoverOpen={datePopoverOpen}
          setDatePopoverOpen={setDatePopoverOpen}
          section={section}
          eventType={event.type}
        />
      )}

      {section === 'settings' ? <EventAiSettingsFields form={form} /> : null}

      {section === 'pricing' && bundleT ? (
        <>
          <EventPriceField form={form} submitAttempted={submitAttempted} />
          {/* Nested Fields so the editor sees the LIVE price as it is typed:
              eligibility and the per-photo readouts both depend on it. */}
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
                          eventType={event.type}
                          t={bundleT}
                        />
                      )}
                    </form.Field>
                  );
                }}
              </form.Field>
            )}
          </form.Field>
        </>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          {labels.cancel}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}
