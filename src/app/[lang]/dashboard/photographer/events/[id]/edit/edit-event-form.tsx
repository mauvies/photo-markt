'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { EventCoverField } from '@/components/event-cover-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { parseAllPhotosCents, parseBundleTiers } from '@/lib/bundle-pricing';
import { bundleScheduleErrorText } from '@/lib/bundle-schedule-error';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { minPhotoPriceMessage } from '@/lib/min-photo-price';
import { getPlanLimitType, isPlanLimitError } from '@/lib/plan-limits';
import { usePhotoUpload } from '@/lib/use-photo-upload';
import { removeEventCoverAction, uploadEventCoverAction } from '../../new/actions';
import { updateEventAction } from './actions';
import { EventAiSettingsFields } from './components/event-ai-settings-fields';
import { EventFormFields } from './components/event-form-fields';
import { EventPhotoGrid } from './components/event-photo-grid';
import {
  type DisplayPhoto,
  eventSchema,
  type FormValues,
  type PendingPhoto,
  type PhotoWithUrl,
} from './edit-event-schema';
import { buildEventUpdateFormData } from './event-form-data';

interface EditEventFormProps {
  event: Event;
  initialPhotos: PhotoWithUrl[];
  /** Signed URL of the event's dedicated cover, or null when it has none (T-166). */
  initialCoverUrl: string | null;
  /**
   * Bundle-pricing copy (T-213). This form's provider carries `newEvent`, which
   * has no ladder strings, so the block is passed explicitly — same shape as
   * `ScopedEventEditForm`.
   */
  bundleT: Dictionary['bundlePricing'];
  /**
   * Event-details copy (T-206) — section titles and the save/cancel labels, in
   * the same `eventDetails` namespace the scoped editor's page already uses, so
   * both routes name the same sections with the same words. Passed rather than
   * read through the provider for the same reason as `bundleT`: the provider
   * here carries `newEvent`.
   */
  detailsT: Dictionary['eventDetails'];
}

export function EditEventForm({
  event,
  initialPhotos,
  initialCoverUrl,
  bundleT,
  detailsT,
}: EditEventFormProps) {
  const router = useRouter();
  const { t } = useTranslations<Dictionary['newEvent']>();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();
  // Dedicated cover (T-166): the standalone cover actions persist immediately
  // (the event already exists), independent of the Save button below.
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(initialCoverUrl);
  const [isCoverPending, startCoverTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoWithUrl[]>(initialPhotos);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
  const upload = usePhotoUpload();

  useEffect(() => {
    setPhotos(initialPhotos);
    setPendingDeletions(new Set());
    setNewFiles([]);
  }, [initialPhotos]);

  const eventDate = event.date ? format(new Date(event.date), 'yyyy-MM-dd') : '';
  // DB stores a `time` ("HH:MM:SS"); the <input type="time"> wants "HH:mm".
  const eventSessionTime = event.session_time?.slice(0, 5);
  const eventSessionEndTime = (
    event as unknown as { session_end_time?: string | null }
  ).session_end_time?.slice(0, 5);

  // `Event` is typed broadly enough that the AI columns may be optional
  // depending on whether the migration has been applied — read defensively.
  const eventAiEnabled = Boolean((event as unknown as Record<string, unknown>).ai_matching_enabled);
  const eventContainsMinors = Boolean(
    (event as unknown as Record<string, unknown>).contains_minors,
  );
  const eventBibDetectionEnabled = Boolean(
    (event as unknown as Record<string, unknown>).bib_detection_enabled,
  );
  const eventRevealGateEnabled = Boolean(
    (event as unknown as Record<string, unknown>).reveal_gate_enabled,
  );

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
    ai_matching_enabled: eventAiEnabled,
    contains_minors: eventContainsMinors,
    bib_detection_enabled: eventBibDetectionEnabled,
    reveal_gate_enabled: eventRevealGateEnabled,
    // T-203: echo the stored ladder so a full edit round-trips it unchanged.
    // The ladder is edited from the Pricing tab's scoped form, not here.
    bundle_tiers: parseBundleTiers((event as unknown as Record<string, unknown>).bundle_tiers),
    bundle_all_photos_cents: parseAllPhotosCents(
      (event as unknown as Record<string, unknown>).bundle_all_photos_cents,
    ),
  };

  const handleDeletePhoto = (photoId: string) => {
    setPendingDeletions((prev) => new Set(prev).add(photoId));
  };

  const handleFiles = (incoming: File[]) => {
    setNewFiles((prev) => {
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
  };

  const removeFile = (target: File) => {
    setNewFiles((prev) => prev.filter((file) => file !== target));
  };

  // Dedicated cover management (T-166). Persists immediately via the standalone
  // owner-only actions (the event already exists) — decoupled from the Save
  // button. Success is silent (the preview is the feedback); failure rolls the
  // preview back and toasts. Object-URL previews are revoked once superseded.
  const handleCoverChange = (file: File | null) => {
    const prior = coverPreviewUrl;
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setCoverPreviewUrl(objectUrl);
      startCoverTransition(async () => {
        try {
          const formData = new FormData();
          formData.append('cover', file);
          await uploadEventCoverAction(event.id, formData);
          if (prior?.startsWith('blob:')) URL.revokeObjectURL(prior);
        } catch (error) {
          console.error(error);
          URL.revokeObjectURL(objectUrl);
          setCoverPreviewUrl(prior);
          toast.error(t('coverUpdateFailed'));
        }
      });
    } else {
      setCoverPreviewUrl(null);
      startCoverTransition(async () => {
        try {
          await removeEventCoverAction(event.id);
          if (prior?.startsWith('blob:')) URL.revokeObjectURL(prior);
        } catch (error) {
          console.error(error);
          setCoverPreviewUrl(prior);
          toast.error(t('coverUpdateFailed'));
        }
      });
    }
  };

  const [newFilePreviews, setNewFilePreviews] = useState<PendingPhoto[]>([]);

  useEffect(() => {
    const previews: PendingPhoto[] = newFiles.map((file) => ({
      id: `pending-${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      original_url: null,
      isPending: true as const,
    }));
    setNewFilePreviews(previews);
    return () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [newFiles]);

  const visiblePhotos: DisplayPhoto[] = [
    ...photos.filter((p) => !pendingDeletions.has(p.id)),
    ...newFilePreviews,
  ];

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const parsed = eventSchema.parse(value);
        setSubmitError(null);

        // This form seeds the ladder but renders NO ladder editor, so it must
        // not speak about it (T-212). Echoing it back was what made lowering a
        // price here throw `BUNDLE_TIERS:total_not_a_discount` — an error about
        // a field the photographer could not see or fix from this page.
        const formData = buildEventUpdateFormData(parsed, { includeBundlePricing: false });

        const photoIdsToDelete = Array.from(pendingDeletions);

        // Two-stage flow: save metadata first (and apply deletes), then run
        // the byte-free direct-upload flow for new files.
        startTransition(async () => {
          try {
            const result = await updateEventAction(event.id, formData, photoIdsToDelete);
            if (!result?.success) return;

            // T-142: sold photos can't be destroyed — they're kept for their
            // buyers and hidden from the gallery. Tell the photographer (the
            // toast persists across the navigation below via the global Toaster).
            if (result.retainedSoldCount > 0) {
              toast.success(t('photosKeptSoldOnEdit'));
            }

            const dashboardPath = lp(`/dashboard/photographer/events/${event.id}`);
            if (newFiles.length === 0) {
              router.push(dashboardPath);
              return;
            }

            try {
              const uploadResult = await upload.run({ eventId: event.id, files: newFiles });
              if (uploadResult.failed.length === 0) {
                const succeeded = uploadResult.attached.length;
                router.push(
                  succeeded > 0 ? `${dashboardPath}?uploaded=${succeeded}` : dashboardPath,
                );
              }
              // partial-failed handled by modal
            } catch (uploadErr) {
              console.error(uploadErr);
            }
          } catch (error) {
            console.error(error);
            if (isPlanLimitError(error)) {
              const limitType = getPlanLimitType(error);
              setSubmitError(
                limitType === 'storage' ? t('storageLimitReached') : t('eventLimitReachedShort'),
              );
              return;
            }
            // T-195: localize the price-floor rejection (server sends the
            // amount as a sentinel; it has no dictionary).
            const minPrice = minPhotoPriceMessage(error, t('priceBelowMinimum'));
            if (minPrice !== null) {
              setSubmitError(minPrice);
              return;
            }
            // T-213: decode the ladder sentinel like every other form that can
            // receive it. Since T-212 this form sends `absent` for both bundle
            // columns, so the action does not currently reject a ladder from
            // here — but the sentinel is a property of the ACTION, shared by
            // every caller, and the failure mode when a caller forgets is silent
            // (a raw `BUNDLE_TIERS:` string in dev, an opaque error in prod).
            const bundleError = bundleScheduleErrorText(error, {
              ...bundleT.errors,
              fallback: bundleT.errors.fallback,
            });
            if (bundleError !== null) {
              setSubmitError(bundleError);
              return;
            }
            setSubmitError(error instanceof Error ? error.message : t('submitError'));
          }
        });
      } catch (error) {
        console.error(error);
        if (error instanceof z.ZodError) {
          setSubmitError(error.issues[0]?.message ?? t('submitError'));
        }
      }
    },
  });

  return (
    <div className="mx-auto w-full max-w-[1300px]">
      <form
        className="flex flex-col gap-5 pb-[calc(9rem+env(safe-area-inset-bottom))] md:pb-28"
        onSubmit={(event) => {
          event.preventDefault();
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

        {/* T-206: the page used to stack cover → (fields | dropzone) → AI → photo
            grid in one flat column with no headings, so nothing said which group
            a control belonged to — or, worse, which controls were already saved.
            It is now grouped into the SAME sections the scoped editor uses
            (`?section=info | settings`, T-179), so the mental model is identical
            whichever way the photographer arrives. */}
        <Card>
          <CardHeader>
            <CardTitle>{detailsT.infoTitle}</CardTitle>
            <CardDescription>{detailsT.editInfoSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Dedicated cover image (T-166) — the ONLY control on this page that
                persists on the spot, via its own actions. That asymmetry was
                invisible before (T-206): everything looked like it was waiting
                for Save, so the badge states which half of the page you are in. */}
            <div className="max-w-sm space-y-2">
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {detailsT.editSavedInstantlyBadge}
              </span>
              <EventCoverField
                previewUrl={coverPreviewUrl}
                onCoverChange={handleCoverChange}
                busy={isCoverPending}
                inputId="edit-cover-image"
                labels={{
                  label: t('coverLabel'),
                  desc: t('coverDesc'),
                  infoAria: t('coverInfoAria'),
                  select: t('coverSelect'),
                  remove: t('coverRemove'),
                }}
              />
              <p className="text-xs text-muted-foreground">{detailsT.editCoverSavedInstantly}</p>
            </div>

            <EventFormFields
              form={form}
              submitAttempted={submitAttempted}
              datePopoverOpen={datePopoverOpen}
              setDatePopoverOpen={setDatePopoverOpen}
              section="info"
              eventType={event.type}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{detailsT.settingsTitle}</CardTitle>
            <CardDescription>{detailsT.editSettingsSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EventFormFields
              form={form}
              submitAttempted={submitAttempted}
              datePopoverOpen={datePopoverOpen}
              setDatePopoverOpen={setDatePopoverOpen}
              section="settings"
              eventType={event.type}
            />
            {/* AI matching + reveal gate + bib detection + minors block. */}
            <EventAiSettingsFields form={form} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{detailsT.editPhotosTitle}</CardTitle>
            <CardDescription>{detailsT.editPhotosSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label>{t('addPhotosLabel')}</Label>
              <Dropzone
                accept=".jpg,.jpeg,.png,.heic"
                onSelect={handleFiles}
                className="rounded-lg"
              />
            </div>

            <EventPhotoGrid
              visiblePhotos={visiblePhotos}
              pendingDeletions={pendingDeletions}
              newFiles={newFiles}
              onDeletePhoto={handleDeletePhoto}
              onRemoveFile={removeFile}
              noPreviewLabel={t('noPreview')}
            />
          </CardContent>
        </Card>

        {/* Action bar. T-206: it used to be `fixed bottom-0 inset-x-0`, which on
            mobile sat UNDER the photographer bottom-nav (both at z-50) and
            ignored the safe-area inset. These are the wizard's offsets — above
            the mobile nav, aligned to the desktop sidebar. */}
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80 md:bottom-0 md:left-(--sidebar-width)">
          <div className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4 sm:px-6">
            <p className="text-xs text-muted-foreground sm:mr-auto">{detailsT.editUnsavedHint}</p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isPending || upload.isActive}
              >
                {detailsT.cancel}
              </Button>
              <Button type="submit" disabled={isPending || upload.isActive}>
                {isPending || upload.isActive ? detailsT.saving : detailsT.saveChanges}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <UploadProgressDialog
        stage={upload.stage}
        progressBytes={upload.progressBytes}
        totalBytes={upload.totalBytes}
        completedCount={upload.completedCount}
        totalCount={upload.totalCount}
        failedCount={upload.failedCount}
        errorMessage={upload.errorMessage}
        labels={{
          title: t('uploadProgressTitle'),
          preparing: t('uploadStatePreparing'),
          uploading: t('uploadStateUploading'),
          finalizing: t('uploadStateFinalizing'),
          done: t('uploadStateDone'),
          partialFailed: t('uploadStatePartialFailed'),
          errorTitle: t('uploadStateError'),
          cancelButton: t('uploadCancelButton'),
          closeButton: t('uploadCloseButton'),
          retryFailedButton: t('uploadRetryFailedButton'),
        }}
        onCancel={() => void upload.cancel()}
        onRetryFailed={() => void upload.retryFailed()}
        onClose={() => {
          const succeeded = upload.completedCount - upload.failedCount;
          const dashboardPath = lp(`/dashboard/photographer/events/${event.id}`);
          upload.reset();
          router.push(succeeded > 0 ? `${dashboardPath}?uploaded=${succeeded}` : dashboardPath);
        }}
      />
    </div>
  );
}
