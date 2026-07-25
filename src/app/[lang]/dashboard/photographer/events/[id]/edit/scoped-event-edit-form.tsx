'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { updateEventAction } from './actions';
import { EventAiSettingsFields } from './components/event-ai-settings-fields';
import { EventFormFields } from './components/event-form-fields';
import { eventSchema, type FormValues } from './edit-event-schema';
import { buildEventUpdateFormData } from './event-form-data';

type ScopedSection = 'info' | 'settings';

type ScopedEventEditFormProps = {
  event: Event;
  section: ScopedSection;
  labels: { save: string; saving: string; cancel: string };
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
export function ScopedEventEditForm({ event, section, labels }: ScopedEventEditFormProps) {
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
  };

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const parsed = eventSchema.parse(value);
        setSubmitError(null);
        const formData = buildEventUpdateFormData(parsed);
        startTransition(async () => {
          try {
            const result = await updateEventAction(event.id, formData);
            if (!result?.success) return;
            router.push(lp(`/dashboard/photographer/events/${event.id}?tab=details`));
          } catch (error) {
            console.error(error);
            setSubmitError(
              error instanceof Error ? error.message : 'Something went wrong. Please try again.',
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

      <EventFormFields
        form={form}
        submitAttempted={submitAttempted}
        datePopoverOpen={datePopoverOpen}
        setDatePopoverOpen={setDatePopoverOpen}
        section={section}
      />

      {section === 'settings' ? <EventAiSettingsFields form={form} /> : null}

      <div className="flex justify-end gap-3 border-t pt-4">
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
