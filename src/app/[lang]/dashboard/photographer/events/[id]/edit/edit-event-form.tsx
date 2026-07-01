'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPlanLimitType, isPlanLimitError } from '@/lib/plan-limits';
import { usePhotoUpload } from '@/lib/use-photo-upload';
import { updateEventAction } from './actions';
import { EventFormFields } from './components/event-form-fields';
import { EventPhotoGrid } from './components/event-photo-grid';
import {
  type DisplayPhoto,
  eventSchema,
  type FormValues,
  type PendingPhoto,
  type PhotoWithUrl,
} from './edit-event-schema';

interface EditEventFormProps {
  event: Event;
  initialPhotos: PhotoWithUrl[];
}

export function EditEventForm({ event, initialPhotos }: EditEventFormProps) {
  const router = useRouter();
  const { t } = useTranslations<Dictionary['newEvent']>();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();
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

  // `Event` is typed broadly enough that the AI columns may be optional
  // depending on whether the migration has been applied — read defensively.
  const eventAiEnabled = Boolean((event as unknown as Record<string, unknown>).ai_matching_enabled);
  const eventContainsMinors = Boolean(
    (event as unknown as Record<string, unknown>).contains_minors,
  );
  const eventBibDetectionEnabled = Boolean(
    (event as unknown as Record<string, unknown>).bib_detection_enabled,
  );

  const defaultValues: FormValues = {
    name: event.name,
    activity: event.activity as FormValues['activity'],
    date: eventDate,
    city: event.city,
    is_public: event.is_public,
    watermark_enabled: event.watermark_enabled,
    is_collaborative: event.is_collaborative,
    allow_guest_upload: event.allow_guest_upload,
    require_upload_approval: event.require_upload_approval,
    price_per_photo: event.price_per_photo,
    ai_matching_enabled: eventAiEnabled,
    contains_minors: eventContainsMinors,
    bib_detection_enabled: eventBibDetectionEnabled,
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

        const formData = new FormData();
        formData.append('name', parsed.name.trim());
        formData.append('activity', parsed.activity);
        formData.append('date', parsed.date);
        if (parsed.city?.trim()) {
          formData.append('city', parsed.city.trim());
        }
        formData.append('is_public', parsed.is_public ? 'true' : 'false');
        formData.append('watermark_enabled', parsed.watermark_enabled ? 'true' : 'false');
        formData.append('is_collaborative', parsed.is_collaborative ? 'true' : 'false');
        formData.append('allow_guest_upload', parsed.allow_guest_upload ? 'true' : 'false');
        formData.append(
          'require_upload_approval',
          parsed.require_upload_approval ? 'true' : 'false',
        );
        formData.append('ai_matching_enabled', parsed.ai_matching_enabled ? 'true' : 'false');
        formData.append('bib_detection_enabled', parsed.bib_detection_enabled ? 'true' : 'false');
        // `contains_minors` is read-only post-creation. We still send the
        // current value so the server-side guard can compare and reject any
        // tampering. The form input is disabled either way.
        formData.append('contains_minors', parsed.contains_minors ? 'true' : 'false');
        if (parsed.price_per_photo !== undefined && parsed.price_per_photo !== null) {
          const price =
            typeof parsed.price_per_photo === 'string'
              ? Number.parseFloat(parsed.price_per_photo)
              : parsed.price_per_photo;
          if (!Number.isNaN(price) && price >= 0) {
            formData.append('price_per_photo', price.toString());
          }
        }

        const photoIdsToDelete = Array.from(pendingDeletions);

        // Two-stage flow: save metadata first (and apply deletes), then run
        // the byte-free direct-upload flow for new files.
        startTransition(async () => {
          try {
            const result = await updateEventAction(event.id, formData, photoIdsToDelete);
            if (!result?.success) return;

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
    <div className="mx-auto w-full max-w-7xl">
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

        {/* AI matching + bib detection block */}
        <div className="grid gap-3 md:grid-cols-2">
          <form.Subscribe selector={(state) => state.values.contains_minors}>
            {(containsMinors) => (
              <>
                <form.Field name="ai_matching_enabled">
                  {(field) => (
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                      <div className="grid gap-1">
                        <Label htmlFor="edit_ai_matching_enabled">
                          {t('aiMatchingLabel' as keyof Dictionary['newEvent'])}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {containsMinors
                            ? t('aiMatchingDisabledByMinors' as keyof Dictionary['newEvent'])
                            : t('aiMatchingDesc' as keyof Dictionary['newEvent'])}
                        </p>
                      </div>
                      <Switch
                        id="edit_ai_matching_enabled"
                        checked={!containsMinors && field.state.value}
                        disabled={containsMinors}
                        onCheckedChange={(checked) => {
                          field.handleChange(checked);
                          field.handleBlur();
                        }}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="bib_detection_enabled">
                  {(field) => (
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3">
                      <div className="grid gap-1">
                        <Label htmlFor="edit_bib_detection_enabled">
                          {t('bibDetectionLabel' as keyof Dictionary['newEvent'])}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {containsMinors
                            ? t('bibDetectionDisabledByMinors' as keyof Dictionary['newEvent'])
                            : t('bibDetectionDesc' as keyof Dictionary['newEvent'])}
                        </p>
                      </div>
                      <Switch
                        id="edit_bib_detection_enabled"
                        checked={!containsMinors && field.state.value}
                        disabled={containsMinors}
                        onCheckedChange={(checked) => {
                          field.handleChange(checked);
                          field.handleBlur();
                        }}
                      />
                    </div>
                  )}
                </form.Field>
                {/* `contains_minors` is read-only after event creation. */}
                <div className="flex items-center justify-between gap-4 rounded-lg border border-input p-3 opacity-90">
                  <div className="grid gap-1">
                    <Label htmlFor="edit_contains_minors">
                      {t('containsMinorsLabel' as keyof Dictionary['newEvent'])}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('containsMinorsImmutableHelper' as keyof Dictionary['newEvent'])}
                    </p>
                  </div>
                  <Switch id="edit_contains_minors" checked={containsMinors} disabled />
                </div>
              </>
            )}
          </form.Subscribe>
        </div>

        {/* Photos Section - Full Width */}
        <div className="space-y-2">
          {/* <h3 className="text-lg font-semibold">Event Photos</h3> */}
          <EventPhotoGrid
            visiblePhotos={visiblePhotos}
            pendingDeletions={pendingDeletions}
            newFiles={newFiles}
            onDeletePhoto={handleDeletePhoto}
            onRemoveFile={removeFile}
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
