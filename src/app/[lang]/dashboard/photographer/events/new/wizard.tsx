'use client';

import { format } from 'date-fns';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { DashboardHeader } from '@/components/dashboard-header';
import { Button } from '@/components/ui/button';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPlanLimitType, isPlanLimitError } from '@/lib/plan-limits';
import { usePhotoUpload } from '@/lib/use-photo-upload';
import { deleteEventAction } from '../actions';
import { createEvent, uploadEventCoverAction } from './actions';
import { activityOptions } from './activity-options';
import { ShareCodeDialog } from './components/share-code-dialog';
import { type StepNumber, WizardSteps } from './components/wizard-steps';
import { shouldDiscardCreatedEvent } from './orphan-cleanup';
import { Step1Config } from './steps/step-1-config';
import { Step2Details } from './steps/step-2-details';
import { Step3Photos } from './steps/step-3-photos';
import { type ReviewSection, Step4Review } from './steps/step-4-review';
import { eventSchema, type FormValues } from './wizard.schema';
import { mergeFilePreviews, removeFileFromPreviews } from './wizard-file-utils';
import {
  DRAFT_KEY,
  HAD_FILES_KEY,
  readStoredState,
  type StoredWizardState,
} from './wizard-storage';
import { type FilePreview, useEventForm } from './wizard-types';

type NewEventT = Dictionary['newEvent'];

const STEP_FIELDS: Record<StepNumber, Array<keyof FormValues>> = {
  1: [],
  2: ['name', 'activity', 'date', 'city', 'price_per_photo'],
  3: [],
  4: [],
};

function parseStepParam(value: string | null): StepNumber {
  const parsed = Number.parseInt(value ?? '1', 10);
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4) return parsed;
  return 1;
}

export default function NewEventForm({
  shareEventLabels,
}: {
  shareEventLabels: Dictionary['shareEvent'];
}) {
  const { t } = useTranslations<NewEventT>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lp = useLocalizedPath();

  const currentStep = parseStepParam(searchParams.get('step'));

  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  // Always points at the latest filePreviews so the unmount cleanup can
  // revoke all object URLs without listing filePreviews as an effect dep.
  const filePreviewsRef = useRef<FilePreview[]>([]);
  filePreviewsRef.current = filePreviews;
  const files = useMemo(() => filePreviews.map((p) => p.file), [filePreviews]);
  const [isPending, startTransition] = useTransition();
  const [photosError, setPhotosError] = useState<string | null>(null);
  // The event is created before photos upload (we need its id to mint signed
  // URLs). Track it so a failed/cancelled upload can soft-delete the orphan
  // rather than leave an event the user never meant to keep (T-054).
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [attachedCount, setAttachedCount] = useState(0);
  // Optional dedicated cover image (T-055). Held as a File (not serializable,
  // so not part of the persisted draft) and uploaded after the event exists.
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const coverPreviewUrlRef = useRef<string | null>(null);
  coverPreviewUrlRef.current = coverPreviewUrl;
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
      // Use setFieldValue instead of form.reset() to restore draft values.
      // form.reset(values) sets this.options.defaultValues = values; TanStack
      // Form then calls update({ defaultValues: EMPTY_DEFAULTS }) on the next
      // render (via useIsomorphicLayoutEffect with no deps), sees the mismatch,
      // and resets the form back to EMPTY_DEFAULTS — erasing the restoration.
      // setFieldValue only patches state.values, leaving options.defaultValues
      // pointing at the original EMPTY_DEFAULTS constant, so the next update()
      // call sees no change and leaves the form alone.
      for (const [key, value] of Object.entries(stored.values)) {
        form.setFieldValue(key as keyof FormValues, value as never, {
          dontUpdateMeta: true,
          dontValidate: true,
          dontRunListeners: true,
        });
      }
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

  // Revoke all object URLs when the wizard unmounts to avoid memory leaks.
  // filePreviewsRef always holds the latest list so we don't need to list
  // filePreviews in the dep array (which would re-register the cleanup on
  // every change instead of running it once on unmount).
  useEffect(() => {
    return () => {
      for (const p of filePreviewsRef.current) URL.revokeObjectURL(p.url);
      if (coverPreviewUrlRef.current) URL.revokeObjectURL(coverPreviewUrlRef.current);
    };
  }, []);

  // Select / replace / clear the optional cover image, keeping a preview URL in
  // sync and revoking the previous one so object URLs don't leak.
  const handleCoverChange = useCallback((file: File | null) => {
    setCoverPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setCoverFile(file);
  }, []);

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
      if (filePreviews.length > 0) {
        sessionStorage.setItem(HAD_FILES_KEY, 'true');
        if (photosLost) setPhotosLost(false);
      } else if (sessionStorage.getItem(HAD_FILES_KEY) === 'true' && !photosLost) {
        // Files were just cleared in this session — drop the flag too.
        sessionStorage.removeItem(HAD_FILES_KEY);
      }
    } catch {
      // Ignore.
    }
  }, [filePreviews.length, hydratedFromStorage, photosLost]);

  const handleFiles = (incoming: File[]) => {
    setFilePreviews((prev) => mergeFilePreviews(prev, incoming, URL.createObjectURL));
    if (incoming.length > 0) {
      setPhotosError(null);
      setPhotosLost(false);
    }
  };

  const removeFile = (target: File) => {
    setFilePreviews((prev) => removeFileFromPreviews(prev, target, URL.revokeObjectURL));
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
      toast.error(t('submitError'));
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
    formData.append('bib_detection_enabled', parsed.bib_detection_enabled ? 'true' : 'false');
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
        // Remember the just-created event so a failed/cancelled upload can
        // discard it. Reset the attached counter for this attempt.
        setPendingEventId(result.eventId);
        setAttachedCount(0);

        // Upload the optional dedicated cover image. Best-effort: a cover
        // failure must NOT discard the event — keep it with no cover and warn.
        if (coverFile) {
          try {
            const coverData = new FormData();
            coverData.append('cover', coverFile);
            await uploadEventCoverAction(result.eventId, coverData);
          } catch (coverErr) {
            console.error('[wizard] cover upload failed', coverErr);
            toast.error(t('coverUploadFailed' as keyof NewEventT));
          }
        }

        const dashboardPath = lp(`/dashboard/photographer/events/${result.eventId}`);
        const goToEvent = (succeededCount: number) => {
          // Navigating to the event = we're keeping it; clear the discard latch.
          setPendingEventId(null);
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
          // Record how many photos actually landed so the dialog's onClose can
          // tell a real event (keep) from an empty orphan (discard).
          setAttachedCount(uploadResult.attached.length);
          // If everything succeeded, redirect with the attached count. The
          // partial-failed path is handled by the modal: the user clicks Retry
          // or Close, and Close navigates to the event (it has real photos).
          if (uploadResult.failed.length === 0) {
            goToEvent(uploadResult.attached.length);
          }
        } catch (uploadErr) {
          // run() threw — the modal shows the error stage with Retry/Close.
          // attachedCount stays 0, so closing on that stage discards the
          // orphan event (see UploadProgressDialog onClose below).
          console.error(uploadErr);
        }
      } catch (error) {
        console.error(error);
        // createEvent itself failed → no event was persisted, nothing to
        // discard. Surface the reason as a toast (not inline red text).
        if (isPlanLimitError(error)) {
          const limitType = getPlanLimitType(error);
          toast.error(
            limitType === 'maxEvents' ? t('eventLimitReachedShort') : t('storageLimitReached'),
          );
          return;
        }
        toast.error(error instanceof Error ? error.message : t('submitError'));
      }
    });
  }, [coverFile, files, form.state.values, goToStep, isPending, lp, router, t, upload]);

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

    // AI face matching, bib detection + minors compliance — shown for every
    // event type since the toggles live in step 1 for all of them.
    configRows.push({
      label: t('aiMatchingLabel' as keyof typeof t),
      value:
        v.contains_minors || !v.ai_matching_enabled ? t('summaryDisabled') : t('summaryEnabled'),
    });
    configRows.push({
      label: t('bibDetectionLabel' as keyof typeof t),
      value:
        v.contains_minors || !v.bib_detection_enabled ? t('summaryDisabled') : t('summaryEnabled'),
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
          {currentStep === 2 && (
            <Step2Details
              form={form}
              submitAttempted={submitAttemptedStep2}
              coverPreviewUrl={coverPreviewUrl}
              onCoverChange={handleCoverChange}
            />
          )}
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
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80 md:bottom-0 md:left-(--sidebar-width)">
          <div className="mx-auto flex w-full max-w-full flex-col items-end gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
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
        shareEventLabels={shareEventLabels}
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
          // The success path already navigated. This handler covers the
          // partial-failed / error / cancelled terminal stages.
          const orphanId = pendingEventId;
          const terminalStage = upload.stage;
          const attached = attachedCount;
          upload.reset();

          if (orphanId && shouldDiscardCreatedEvent(terminalStage, attached)) {
            // The create+upload flow failed/was cancelled with nothing saved:
            // soft-delete the orphan event so it never surfaces in the list.
            // The user's form values stay in memory so they can retry.
            setPendingEventId(null);
            startTransition(async () => {
              try {
                await deleteEventAction(orphanId);
              } catch (err) {
                console.error('[wizard] failed to discard orphan event', err);
              }
            });
            toast.error(t('createFailedEventDiscarded' as keyof NewEventT));
            return;
          }

          // Partial success (some photos attached): keep the event and go to it
          // so the destination's RejectedToast can flag any worker rejections.
          if (orphanId && attached > 0) {
            setPendingEventId(null);
            try {
              sessionStorage.removeItem(DRAFT_KEY);
              sessionStorage.removeItem(HAD_FILES_KEY);
            } catch {
              // Ignore.
            }
            router.push(`${lp(`/dashboard/photographer/events/${orphanId}`)}?uploaded=${attached}`);
          }
        }}
      />
    </div>
  );
}
