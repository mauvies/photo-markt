'use client';

import { AlertTriangle, Info, X } from 'lucide-react';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/components/uploader/Dropzone';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { EventType } from '../wizard.schema';
import type { FilePreview } from '../wizard-types';

type NewEventT = Dictionary['newEvent'];

type Step4PhotosProps = {
  previews: FilePreview[];
  error: string | null;
  // Shown when the user lands on this step after a refresh that wiped the
  // in-memory File[] (we can't restore Files from localStorage).
  photosLost: boolean;
  eventType: EventType;
  onFiles: (files: File[]) => void;
  onRemove: (file: File) => void;
};

export function Step4Photos({
  previews,
  error,
  photosLost,
  eventType,
  onFiles,
  onRemove,
}: Step4PhotosProps) {
  const { t } = useTranslations<NewEventT>();
  const isCollaborative = eventType === 'collaborative';
  const isOrganizer = eventType === 'organizer';

  if (isOrganizer) {
    return (
      <div className="grid gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-input bg-muted/30 p-4 text-sm">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="grid gap-1">
            <p className="font-medium">{t('organizerNoOwnPhotosTitle')}</p>
            <p className="text-muted-foreground">{t('organizerNoOwnPhotos')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {photosLost && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('photosLostBanner')}</p>
        </div>
      )}

      <div className="grid gap-2">
        <Label>{t('addPhotosLabel')}</Label>
        <Dropzone
          accept=".jpg,.jpeg,.png,.heic"
          onSelect={onFiles}
          className="min-h-48 rounded-lg"
        />
        {isCollaborative && (
          <p className="text-xs text-muted-foreground">{t('collaborativePhotosOptional')}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {previews.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">{t('eventPhotosHeading')}</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {previews.map((preview) => (
              <div
                key={preview.id}
                className="group relative aspect-square overflow-visible rounded-lg"
              >
                <div className="absolute inset-0 overflow-hidden rounded-lg border border-dashed border-primary/50 bg-muted">
                  <Image
                    src={preview.url}
                    alt={`Preview ${preview.file.name}`}
                    fill
                    sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 14vw"
                    className="object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(preview.file)}
                  className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/85 text-gray-100 shadow-sm transition-opacity hover:bg-foreground md:opacity-0 md:group-hover:opacity-100"
                  aria-label={t('removePhotoAriaLabel')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
