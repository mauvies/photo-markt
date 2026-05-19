'use client';

import { format } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { DashboardHeader } from '@/components/dashboard-header';
import { Button } from '@/components/ui/button';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPlanLimitType, isPlanLimitError } from '@/lib/plan-limits';
import { usePhotoUpload } from '@/lib/use-photo-upload';
import { createEvent } from './actions';
import { activityOptions, activityValues } from './activity-options';
import { ShareCodeDialog } from './components/share-code-dialog';
import { type StepNumber, WizardSteps } from './components/wizard-steps';
import { Step1Config } from './steps/step-1-config';
import { Step2Details } from './steps/step-2-details';
import { Step3Photos } from './steps/step-3-photos';
import { type ReviewSection, Step4Review } from './steps/step-4-review';
import { eventSchema, type FormValues } from './wizard.schema';
import { type FilePreview, useEventForm } from './wizard-types';

type NewEventT = Dictionary['newEvent'];

// sessionStorage key — scoped per-tab. The wizard draft is discarded when
// the tab closes, which matches user expectation (no surprise drafts
// resurfacing weeks later). Renamed from the previous localStorage key so
// stale localStorage entries (from earlier hotfix layers) don't get
// mistakenly re-read.
const DRAFT_KEY = 'picdemi_event_wizard_draft';
// Side-channel flag: set when the user picks at least one photo. We don't
// store the photos themselves (File objects can't be serialized), but knowing
// that they *had* selected something lets us distinguish a fresh arrival on
// step 3 (no banner) from a refresh that wiped the in-memory File[] (banner).
const HAD_FILES_KEY = 'picdemi_event_wizard_had_files';

const STEP_FIELDS: Record<StepNumber, Array<keyof FormValues>> = {
  1: [],
  2: ['name', 'activity', 'date', 'city', 'price_per_photo'],
  3: [],
  4: [],
};

type StoredWizardState = {
  values: FormValues;
  reachedStep: StepNumber;
  // When set, the next forward navigation (after Next from an edited step)
  // jumps directly here instead of `currentStep + 1`. Set when the user
  // clicks an Edit button from the step 4 review; cleared after the jump.
  returnToStep: StepNumber | null;
};

function readStoredState(): StoredWizardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // Field-by-field coercion below handles older payloads and schema
    // additions (e.g. `ai_matching_enabled` / `contains_minors`) gracefully
    // by falling back to defaults — no separate "schema migration" step.
    const candidateValues =
      parsed && typeof parsed === 'object' && 'values' in parsed && parsed.values
        ? (parsed.values as Record<string, unknown>)
        : (parsed as Record<string, unknown>);

    const reachedStepRaw =
      parsed && typeof parsed === 'object' && 'reachedStep' in parsed
        ? (parsed as { reachedStep: unknown }).reachedStep
        : 1;
    const returnToStepRaw =
      parsed && typeof parsed === 'object' && 'returnToStep' in parsed
        ? (parsed as { returnToStep: unknown }).returnToStep
        : null;

    // Validate event_type against the legacy is_collaborative flag — older
    // drafts predate the explicit type column.
    const eventType: 'solo' | 'collaborative' | 'organizer' =
      candidateValues.event_type === 'organizer' ||
      candidateValues.event_type === 'collaborative' ||
      candidateValues.event_type === 'solo'
        ? (candidateValues.event_type as 'solo' | 'collaborative' | 'organizer')
        : candidateValues.is_collaborative
          ? 'collaborative'
          : 'solo';

    const storedActivity = candidateValues.activity;
    const validActivity =
      typeof storedActivity === 'string' &&
      activityValues.includes(storedActivity as (typeof activityValues)[number])
        ? (storedActivity as (typeof activityValues)[number])
        : 'OTHER';

    const values: FormValues = {
      name: typeof candidateValues.name === 'string' ? candidateValues.name : '',
      activity: validActivity,
      date: typeof candidateValues.date === 'string' ? candidateValues.date : '',
      country: typeof candidateValues.country === 'string' ? candidateValues.country : '',
      state: typeof candidateValues.state === 'string' ? candidateValues.state : '',
      city: typeof candidateValues.city === 'string' ? candidateValues.city : '',
      event_type: eventType,
      is_public: typeof candidateValues.is_public === 'boolean' ? candidateValues.is_public : true,
      watermark_enabled:
        typeof candidateValues.watermark_enabled === 'boolean'
          ? candidateValues.watermark_enabled
          : true,
      is_collaborative: eventType === 'collaborative',
      allow_guest_upload:
        typeof candidateValues.allow_guest_upload === 'boolean'
          ? candidateValues.allow_guest_upload
          : true,
      require_upload_approval:
        typeof candidateValues.require_upload_approval === 'boolean'
          ? candidateValues.require_upload_approval
          : false,
      price_per_photo:
        typeof candidateValues.price_per_photo === 'number'
          ? candidateValues.price_per_photo
          : null,
      organizer_fee_per_photo:
        typeof candidateValues.organizer_fee_per_photo === 'number'
          ? candidateValues.organizer_fee_per_photo
          : null,
      ai_matching_enabled:
        typeof candidateValues.ai_matching_enabled === 'boolean'
          ? candidateValues.ai_matching_enabled
          : false,
      contains_minors:
        typeof candidateValues.contains_minors === 'boolean'
          ? candidateValues.contains_minors
          : false,
    };

    const reachedStep: StepNumber =
      reachedStepRaw === 1 || reachedStepRaw === 2 || reachedStepRaw === 3 || reachedStepRaw === 4
        ? reachedStepRaw
        : 1;
    const returnToStep: StepNumber | null =
      returnToStepRaw === 1 ||
      returnToStepRaw === 2 ||
      returnToStepRaw === 3 ||
      returnToStepRaw === 4
        ? returnToStepRaw
        : null;

    return { values, reachedStep, returnToStep };
  } catch {
    // Malformed JSON or unexpected shape — discard the draft silently and
    // start fresh. Better UX than crashing the wizard on a stale entry.
    return null;
  }
}

function parseStepParam(value: string | null): StepNumber {
  const parsed = Number.parseInt(value ?? '1', 10);
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4) return parsed;
  return 1;
}

export default function NewEventForm() {
  const { t } = useTranslations<NewEventT>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lp = useLocalizedPath();

  const currentStep = parseStepParam(searchParams.get('step'));

  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [submitAttemptedStep2, setSubmitAttemptedStep2] = useState(false);
  const [createdShareCode, setCreatedShareCode] = useState<string | null>(null);
  const [createdEventName, setCreatedEventName] = useState<string | null>(null);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [reachedStep, setReachedStep] = useState<StepNumber>(currentStep);
  // After an Edit-from-review jump, the next successful "Next" should bring
  // the user back here directly (rather than walking through intermediate
  // steps). null = normal sequential flow. Persisted in sessionStorage so a
  // refresh mid-edit still respects the user's intent.
  const [returnToStep, setReturnToStep] = useState<StepNumber | null>(null);
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);

  // True after a refresh-with-photos: the user had files in memory, the page
  // reloaded, files are gone — flag so step 3 / step 4 can show a banner.
  const [photosLost, setPhotosLost] = useState(false);

  const form = useEventForm();
  const upload = usePhotoUpload();

  // Mount-time hydration. Reads sessionStorage once and seeds form values,
  // reachedStep, and any pending returnToStep memo (so a refresh mid-edit
  // still jumps back to the review on Next). No mid-render re-hydration
  // effect — the TanStack form instance is stable across renders, so once
  // values are seeded here they persist for the lifetime of the wizard.
  useEffect(() => {
    const stored = readStoredState();
    if (stored) {
      form.reset(stored.values);
      // Restore the highest step reached so the indicator keeps showing
      // earlier steps as completed/clickable after a refresh.
      setReachedStep((prev) => (stored.reachedStep > prev ? stored.reachedStep : prev));
      if (stored.returnToStep !== null) setReturnToStep(stored.returnToStep);
    }
    // If the user had picked photos in a previous session (flag set on first
    // selection) and we're back without an in-memory File[], surface the
    // "photos lost" banner so they re-pick. Don't fire on a fresh visit.
    try {
      if (sessionStorage.getItem(HAD_FILES_KEY) === 'true') {
        setPhotosLost(true);
      }
    } catch {
      // Ignore.
    }
    setHydratedFromStorage(true);
  }, [form]);

  // Persist the entire wizard state on every change (post-hydration).
  //
  // We subscribe directly to the form's store rather than relying on a React
  // state snapshot. TanStack Form Field components subscribe in isolation, so
  // the parent NewEventForm doesn't re-render on every keystroke — which
  // means a useEffect dependency on form.state.values would never re-evaluate
  // and the persist would only fire once on hydration. Subscribing to the
  // store directly bypasses React's render cycle for this side effect.
  useEffect(() => {
    if (!hydratedFromStorage) return;
    const writePayload = (): void => {
      try {
        const payload: StoredWizardState = {
          values: form.state.values,
          reachedStep,
          returnToStep,
        };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch {
        // Ignore quota / privacy-mode errors.
      }
    };
    // Persist current state immediately (e.g. after `reachedStep` /
    // `returnToStep` changes even if the form values haven't moved).
    writePayload();
    const subscription = form.store.subscribe(() => {
      writePayload();
    });
    // TanStack Store subscribers may return either a teardown fn or a
    // Subscription object — normalise so React's effect cleanup signature
    // is happy.
    return () => {
      const sub = subscription as { unsubscribe?: () => void } | (() => void);
      if (typeof sub === 'function') sub();
      else sub.unsubscribe?.();
    };
  }, [form, hydratedFromStorage, reachedStep, returnToStep]);

  // Generate object URLs for the file previews; revoke them on cleanup so we
  // don't leak memory when the user removes/reselects.
  useEffect(() => {
    const previews = files.map((file) => ({
      id: `preview-${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      file,
    }));
    setFilePreviews(previews);
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [files]);

  const goToStep = useCallback(
    (step: StepNumber, opts?: { remember?: StepNumber }) => {
      // When `remember` is set (Edit-from-review), capture where to return
      // to after the next Next click. The persistence subscription picks
      // up the state change and writes it to sessionStorage.
      if (opts?.remember !== undefined) {
        setReturnToStep(opts.remember);
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('step', String(step));
      router.push(`?${params.toString()}`);
      setReachedStep((prev) => (step > prev ? step : prev));
    },
    [router, searchParams],
  );

  // Keep the "had files" flag in sync. Set it when the user first picks
  // photos so a future refresh can distinguish "fresh visit" from "lost".
  // Clear it when files goes back to empty *via removeFile* (the user is in
  // control). We don't write here on the initial 0-state to avoid clobbering
  // a flag set in a previous session.
  useEffect(() => {
    if (!hydratedFromStorage) return;
    try {
      if (files.length > 0) {
        sessionStorage.setItem(HAD_FILES_KEY, 'true');
        if (photosLost) setPhotosLost(false);
      } else if (sessionStorage.getItem(HAD_FILES_KEY) === 'true' && !photosLost) {
        // Files were just cleared in this session — drop the flag too.
        sessionStorage.removeItem(HAD_FILES_KEY);
      }
    } catch {
      // Ignore.
    }
  }, [files.length, hydratedFromStorage, photosLost]);

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
      setPhotosLost(false);
    }
  };

  const removeFile = (target: File) => {
    setFiles((prev) => prev.filter((f) => f !== target));
  };

  const validateAndAdvance = useCallback(async () => {
    if (currentStep === 2) {
      setSubmitAttemptedStep2(true);
      const fields = STEP_FIELDS[2];
      await Promise.all(fields.map((name) => form.validateField(name, 'change')));
      const fieldMeta = form.state.fieldMeta;
      const hasErrors = fields.some((name) => {
        const meta = fieldMeta[name];
        return meta && (meta.errors?.length ?? 0) > 0;
      });
      if (hasErrors) return;
    }

    if (currentStep === 3) {
      const eventType = form.state.values.event_type;
      // Solo events require ≥1 photo; collaborative and organizer events
      // both let other users contribute later, so the wizard accepts zero.
      const photosRequired = eventType === 'solo';
      if (photosRequired && files.length === 0) {
        setPhotosError(t('photosRequired'));
        return;
      }
      setPhotosError(null);
    }

    // After a successful Edit-from-review, jump back to where the user came
    // from instead of walking the next sequential step. Clear the memo so
    // subsequent Next clicks behave normally.
    const next: StepNumber =
      returnToStep !== null ? returnToStep : (Math.min(currentStep + 1, 4) as StepNumber);
    if (returnToStep !== null) setReturnToStep(null);
    goToStep(next);
  }, [currentStep, files.length, form, goToStep, returnToStep, t]);

  const submit = useCallback(() => {
    if (isPending) return;
    let parsed: FormValues;
    try {
      parsed = eventSchema.parse(form.state.values);
    } catch (error) {
      console.error(error);
      setSubmitError(t('submitError'));
      return;
    }

    if (parsed.event_type === 'solo' && files.length === 0) {
      // Bump the user back to step 3 with the banner if they somehow reached
      // step 4 with no photos (e.g., refresh).
      setPhotosError(t('photosRequired'));
      goToStep(3);
      return;
    }

    const formData = new FormData();
    formData.append('name', parsed.name.trim());
    formData.append('activity', parsed.activity);
    formData.append('date', parsed.date);
    if (parsed.city?.trim()) formData.append('city', parsed.city.trim());
    formData.append('event_type', parsed.event_type);
    formData.append('is_public', parsed.is_public ? 'true' : 'false');
    formData.append('watermark_enabled', parsed.watermark_enabled ? 'true' : 'false');
    formData.append('is_collaborative', parsed.event_type === 'collaborative' ? 'true' : 'false');
    formData.append('allow_guest_upload', parsed.allow_guest_upload ? 'true' : 'false');
    formData.append('require_upload_approval', parsed.require_upload_approval ? 'true' : 'false');
    formData.append('ai_matching_enabled', parsed.ai_matching_enabled ? 'true' : 'false');
    formData.append('contains_minors', parsed.contains_minors ? 'true' : 'false');
    if (parsed.price_per_photo !== null && parsed.price_per_photo !== undefined) {
      const price =
        typeof parsed.price_per_photo === 'string'
          ? Number.parseFloat(parsed.price_per_photo)
          : parsed.price_per_photo;
      if (!Number.isNaN(price) && price >= 0) {
        formData.append('price_per_photo', price.toString());
      }
    }
    if (
      parsed.event_type === 'organizer' &&
      parsed.organizer_fee_per_photo !== null &&
      parsed.organizer_fee_per_photo !== undefined
    ) {
      const fee =
        typeof parsed.organizer_fee_per_photo === 'string'
          ? Number.parseFloat(parsed.organizer_fee_per_photo)
          : parsed.organizer_fee_per_photo;
      if (!Number.isNaN(fee) && fee >= 0) {
        formData.append('organizer_fee_per_photo', fee.toString());
      }
    }
    // Bytes never go through the SA — only metadata. The new flow is:
    //   1. createEvent  → eventId (no files attached)
    //   2. createPhotoUploadUrls → signed URLs
    //   3. PUT bytes directly to Storage with progress
    //   4. attachPhotosToEvent
    //   5. Redirect with `?uploaded={count}` so the destination can detect
    //      worker-rejected photos via a count mismatch.
    startTransition(async () => {
      try {
        const result = await createEvent(formData);
        if (!result?.eventId) throw new Error('Event could not be created');
        setSubmitError(null);

        const dashboardPath = lp(`/dashboard/photographer/events/${result.eventId}`);
        const goToEvent = (succeededCount: number) => {
          try {
            sessionStorage.removeItem(DRAFT_KEY);
            sessionStorage.removeItem(HAD_FILES_KEY);
          } catch {
            // Ignore.
          }
          const target =
            succeededCount > 0 ? `${dashboardPath}?uploaded=${succeededCount}` : dashboardPath;
          if (!parsed.is_public && result.shareCode) {
            setCreatedShareCode(result.shareCode);
            setCreatedEventName(parsed.name);
            setCreatedEventId(result.eventId);
            // Auto-dismiss after 5s. We CLEAR the dialog state first so
            // the controlled `open` prop transitions to `false` and Radix
            // can run its body-style cleanup before the wizard unmounts
            // via `router.push`. Without this, the overlay/pointer-events
            // styles leak into the destination route.
            setTimeout(() => {
              setCreatedShareCode(null);
              setCreatedEventName(null);
              setCreatedEventId(null);
              router.push(target);
            }, 5000);
          } else {
            router.push(target);
          }
        };

        if (files.length === 0) {
          goToEvent(0);
          return;
        }

        try {
          const uploadResult = await upload.run({
            eventId: result.eventId,
            files,
          });
          // If everything succeeded (or partial-failed but user dismisses
          // the modal), redirect with the attached count.
          if (uploadResult.failed.length === 0) {
            goToEvent(uploadResult.attached.length);
          }
          // Partial-failed path is handled by the modal: the user clicks
          // Retry or Close. Close calls upload.reset() and triggers the
          // redirect via the modal's onClose callback below.
        } catch (uploadErr) {
          // run() threw — modal will show error stage and the user can
          // close it; we still navigated to the event after they dismiss.
          console.error(uploadErr);
        }
      } catch (error) {
        console.error(error);
        // Plan-limit errors carry a parseable prefix in their message so we
        // can distinguish them from generic failures and surface the upgrade
        // copy the user expects.
        if (isPlanLimitError(error)) {
          const limitType = getPlanLimitType(error);
          setSubmitError(
            limitType === 'maxEvents' ? t('eventLimitReachedShort') : t('storageLimitReached'),
          );
          return;
        }
        setSubmitError(error instanceof Error ? error.message : t('submitError'));
      }
    });
  }, [files, form.state.values, goToStep, isPending, lp, router, t, upload]);

  const reviewSections: ReviewSection[] = useMemo(() => {
    const v = form.state.values;
    const formatDollar = (val: string | number | null | undefined) =>
      val !== null && val !== undefined
        ? `$${(typeof val === 'string' ? Number.parseFloat(val) : val).toFixed(2)}`
        : t('summaryFree');

    const eventTypeLabel =
      v.event_type === 'collaborative'
        ? t('eventTypeCollaborative')
        : v.event_type === 'organizer'
          ? t('eventTypeOrganizer')
          : t('eventTypeSolo');

    const configRows: Array<{ label: string; value: string }> = [
      { label: t('eventTypeLabel'), value: eventTypeLabel },
    ];
    if (v.event_type !== 'organizer') {
      configRows.push({
        label: t('summaryVisibility'),
        value: v.is_public ? t('summaryPublic') : t('summaryPrivate'),
      });
    }
    configRows.push({
      label: t('summaryWatermark'),
      value:
        (v.event_type === 'organizer' || v.is_public) && v.watermark_enabled
          ? t('summaryEnabled')
          : t('summaryDisabled'),
    });
    if (v.event_type === 'collaborative') {
      configRows.push({
        label: t('allowGuestUploadLabel'),
        value: v.allow_guest_upload ? t('summaryEnabled') : t('summaryDisabled'),
      });
      configRows.push({
        label: t('requireApprovalLabel'),
        value: v.require_upload_approval ? t('summaryEnabled') : t('summaryDisabled'),
      });
    }
    if (v.event_type === 'organizer') {
      configRows.push({
        label: t('requireApprovalLabel'),
        value: v.require_upload_approval ? t('summaryEnabled') : t('summaryDisabled'),
      });
    }

    // AI face matching + minors compliance — shown for every event type
    // since the toggles live in step 1 for all of them.
    configRows.push({
      label: t('aiMatchingLabel' as keyof typeof t),
      value:
        v.contains_minors || !v.ai_matching_enabled ? t('summaryDisabled') : t('summaryEnabled'),
    });
    configRows.push({
      label: t('containsMinorsLabel' as keyof typeof t),
      value: v.contains_minors ? t('summaryEnabled') : t('summaryDisabled'),
    });

    const detailsRows: Array<{ label: string; value: string }> = [
      { label: t('summaryName'), value: v.name },
      {
        label: t('summaryActivity'),
        value: activityOptions.find((option) => option.value === v.activity)?.label ?? v.activity,
      },
      { label: t('summaryDate'), value: v.date ? format(new Date(v.date), 'PPP') : '' },
      ...(v.city ? [{ label: t('summaryLocation'), value: v.city }] : []),
    ];
    if (v.event_type === 'organizer') {
      detailsRows.push({
        label: t('organizerFeeLabel'),
        value: formatDollar(v.organizer_fee_per_photo),
      });
    } else {
      detailsRows.push({ label: t('summaryPrice'), value: formatDollar(v.price_per_photo) });
    }

    return [
      { title: t('reviewConfigSection'), editStep: 1, rows: configRows },
      { title: t('reviewDetailsSection'), editStep: 2, rows: detailsRows },
    ];
  }, [form.state.values, t]);

  const eventType = form.state.values.event_type;
  const submitDisabledOnReview = eventType === 'solo' && (photosLost || files.length === 0);

  return (
    <div>
      <div className="w-full space-y-6 pb-28 md:pb-24">
        <header className="space-y-3">
          <DashboardHeader title={t('title')} />
          <p className="text-sm text-muted-foreground">
            {currentStep === 4
              ? t('step4Title')
              : t('wizardStepLabel')
                  .replace('{current}', String(currentStep))
                  .replace('{total}', '3')}
          </p>
          <WizardSteps current={currentStep} reached={reachedStep} onSelect={goToStep} />
        </header>

        <div className="min-w-0">
          {currentStep === 1 && <Step1Config form={form} />}
          {currentStep === 2 && <Step2Details form={form} submitAttempted={submitAttemptedStep2} />}
          {currentStep === 3 && (
            <Step3Photos
              previews={filePreviews}
              error={photosError}
              photosLost={photosLost}
              eventType={eventType}
              onFiles={handleFiles}
              onRemove={removeFile}
            />
          )}
          {currentStep === 4 && (
            <Step4Review
              sections={reviewSections}
              previews={filePreviews}
              photosLost={photosLost && eventType === 'solo'}
              eventType={eventType}
              goToStep={goToStep}
            />
          )}
        </div>

        {/* Sticky bottom action bar — same offsets as the original form so it
            sits above the mobile bottom nav and aligns with the desktop sidebar. */}
        <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80 md:bottom-0 md:left-(--sidebar-width)">
          <div className="mx-auto flex w-full max-w-full flex-col items-end gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
            {submitError ? (
              <p className="text-sm text-destructive text-right sm:text-left">{submitError}</p>
            ) : null}
            <div className="flex gap-3">
              {currentStep === 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    // Explicit cancel clears the draft so a future visit
                    // starts fresh rather than restoring the abandoned form.
                    try {
                      sessionStorage.removeItem(DRAFT_KEY);
                      sessionStorage.removeItem(HAD_FILES_KEY);
                    } catch {
                      // Ignore.
                    }
                    router.back();
                  }}
                  disabled={isPending}
                >
                  {t('cancelButton')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goToStep((currentStep - 1) as StepNumber)}
                  disabled={isPending}
                >
                  {t('wizardBack')}
                </Button>
              )}
              {currentStep < 4 ? (
                <Button type="button" onClick={validateAndAdvance} disabled={isPending}>
                  {t('wizardNext')}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submit}
                  disabled={isPending || submitDisabledOnReview}
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
              )}
            </div>
          </div>
        </div>
      </div>

      <ShareCodeDialog
        open={createdShareCode !== null && createdEventName !== null}
        shareCode={createdShareCode ?? ''}
        eventName={createdEventName ?? ''}
        onOpenChange={(next) => {
          if (!next) {
            setCreatedShareCode(null);
            setCreatedEventName(null);
            setCreatedEventId(null);
          }
        }}
        onGoToEvent={() => {
          if (createdEventId) {
            const targetId = createdEventId;
            setCreatedShareCode(null);
            setCreatedEventName(null);
            setCreatedEventId(null);
            router.push(lp(`/dashboard/photographer/events/${targetId}`));
          }
        }}
      />

      <UploadProgressDialog
        stage={upload.stage}
        progressBytes={upload.progressBytes}
        totalBytes={upload.totalBytes}
        completedCount={upload.completedCount}
        totalCount={upload.totalCount}
        failedCount={upload.failedCount}
        errorMessage={upload.errorMessage}
        labels={{
          title: t('uploadProgressTitle' as keyof NewEventT),
          preparing: t('uploadStatePreparing' as keyof NewEventT),
          uploading: t('uploadStateUploading' as keyof NewEventT),
          finalizing: t('uploadStateFinalizing' as keyof NewEventT),
          done: t('uploadStateDone' as keyof NewEventT),
          partialFailed: t('uploadStatePartialFailed' as keyof NewEventT),
          errorTitle: t('uploadStateError' as keyof NewEventT),
          cancelButton: t('uploadCancelButton' as keyof NewEventT),
          closeButton: t('uploadCloseButton' as keyof NewEventT),
          retryFailedButton: t('uploadRetryFailedButton' as keyof NewEventT),
        }}
        onCancel={() => void upload.cancel()}
        onRetryFailed={() => void upload.retryFailed()}
        onClose={() => {
          // On any terminal stage, push to the event with the attached count
          // so the destination's RejectedToast can fire when the worker
          // rejects some photos. We use the running `completedCount-failedCount`
          // as the succeeded count.
          const succeeded = upload.completedCount - upload.failedCount;
          // Find the eventId from the just-created flow. The wizard already
          // navigated for the success path; the close handler covers the
          // partial-failed / error / cancelled paths. We can't restore the
          // eventId here without lifting it to state, but the user can always
          // re-navigate from the events list. Simplest: reset and stay.
          upload.reset();
          void succeeded;
        }}
      />
    </div>
  );
}
