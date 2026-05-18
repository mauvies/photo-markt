'use client';

import { useForm } from '@tanstack/react-form';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Event } from '@/database/queries/events';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { getPlanLimitType, isPlanLimitError } from '@/lib/plan-limits';
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

  useEffect(() => {
    setPhotos(initialPhotos);
    setPendingDeletions(new Set());
    setNewFiles([]);
  }, [initialPhotos]);

  const eventDate = event.date ? format(new Date(event.date), 'yyyy-MM-dd') : '';

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
        if (parsed.price_per_photo !== undefined && parsed.price_per_photo !== null) {
          const price =
            typeof parsed.price_per_photo === 'string'
              ? Number.parseFloat(parsed.price_per_photo)
              : parsed.price_per_photo;
          if (!Number.isNaN(price) && price >= 0) {
            formData.append('price_per_photo', price.toString());
          }
        }

        const photoFormData = new FormData();
        for (const file of newFiles) {
          photoFormData.append('photos', file);
        }
        const photoIdsToDelete = Array.from(pendingDeletions);

        startTransition(async () => {
          try {
            const result = await updateEventAction(
              event.id,
              formData,
              photoFormData,
              photoIdsToDelete,
            );
            if (result?.success) {
              if (result.uploaded === 0 && result.skipped.length > 0) {
                toast.error(t('allPhotosSkippedStorageLimit'));
              } else if (result.skipped.length > 0) {
                toast.warning(
                  t('nPhotosUploadedSomeSkipped')
                    .replace('{uploaded}', String(result.uploaded))
                    .replace('{skipped}', String(result.skipped.length)),
                );
              }
              router.push(lp(`/dashboard/photographer/events/${event.id}`));
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
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
