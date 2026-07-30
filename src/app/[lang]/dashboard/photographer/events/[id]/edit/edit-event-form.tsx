'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { EventCoverField } from '@/components/event-cover-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { parseBundleTiers } from '@/lib/bundle-pricing';
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
}

export function EditEventForm({ event, initialPhotos, initialCoverUrl }: EditEventFormProps) {
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
          toast.error(t('coverUpdateFailed' as keyof Dictionary['newEvent']));
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
          toast.error(t('coverUpdateFailed' as keyof Dictionary['newEvent']));
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

        const formData = buildEventUpdateFormData(parsed);

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
    <div className="mx-auto w-full max-w-[1300px]">
      <form
        className="flex flex-col gap-5 pb-24"
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

        {/* Dedicated cover image (T-166) — managed independently of Save, via the
            standalone cover actions. Compact so it doesn't dominate the form. */}
        <div className="max-w-sm">
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
        </div>

        {/* Top Row: Form and Upload Section */}
        <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <EventFormFields
            form={form}
            submitAttempted={submitAttempted}
            datePopoverOpen={datePopoverOpen}
            setDatePopoverOpen={setDatePopoverOpen}
          />

          {/* Right Half: Upload Section */}
          <div className="flex flex-col gap-2 lg:sticky lg:top-4">
            <Label>Add Photos</Label>
            {/* <p className="text-xs text-muted-foreground">
              Photos will be added when you save changes
            </p> */}
            <Dropzone
              accept=".jpg,.jpeg,.png,.heic"
              onSelect={handleFiles}
              className="flex-1 rounded-lg"
            />
          </div>
        </div>

        {/* AI matching + reveal gate + bib detection + minors block. */}
        <EventAiSettingsFields form={form} />

        {/* Photos Section - Full Width */}
        <div className="space-y-2">
          {/* <h3 className="text-lg font-semibold">Event Photos</h3> */}
          <EventPhotoGrid
            visiblePhotos={visiblePhotos}
            pendingDeletions={pendingDeletions}
            newFiles={newFiles}
            onDeletePhoto={handleDeletePhoto}
            onRemoveFile={removeFile}
            noPreviewLabel={t('noPreview' as keyof Dictionary['newEvent'])}
          />
        </div>

        {/* Action Buttons */}
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-end gap-4 border-t bg-background px-6 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending || upload.isActive}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || upload.isActive}>
            {isPending || upload.isActive ? 'Saving...' : 'Save Changes'}
          </Button>
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
          title: t('uploadProgressTitle' as keyof Dictionary['newEvent']),
          preparing: t('uploadStatePreparing' as keyof Dictionary['newEvent']),
          uploading: t('uploadStateUploading' as keyof Dictionary['newEvent']),
          finalizing: t('uploadStateFinalizing' as keyof Dictionary['newEvent']),
          done: t('uploadStateDone' as keyof Dictionary['newEvent']),
          partialFailed: t('uploadStatePartialFailed' as keyof Dictionary['newEvent']),
          errorTitle: t('uploadStateError' as keyof Dictionary['newEvent']),
          cancelButton: t('uploadCancelButton' as keyof Dictionary['newEvent']),
          closeButton: t('uploadCloseButton' as keyof Dictionary['newEvent']),
          retryFailedButton: t('uploadRetryFailedButton' as keyof Dictionary['newEvent']),
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
