'use client';

import { AlertTriangle, Info, X } from 'lucide-react';
import Image from 'next/image';
import { EventCoverField } from '@/components/event-cover-field';
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
  // Optional dedicated cover image (T-055). Object-URL preview + change handler
  // owned by the wizard shell (the File isn't a serializable form field).
  // Lives here since T-210 — both actions on this step are "pick images".
  coverPreviewUrl: string | null;
  onCoverChange: (file: File | null) => void;
  onFiles: (files: File[]) => void;
  onRemove: (file: File) => void;
};

export function Step4Photos({
  previews,
  error,
  photosLost,
  eventType,
  coverPreviewUrl,
  onCoverChange,
  onFiles,
  onRemove,
}: Step4PhotosProps) {
  const { t } = useTranslations<NewEventT>();
  const isCollaborative = eventType === 'collaborative';
  const isOrganizer = eventType === 'organizer';

  return (
    <div className="grid gap-4">
      {/* Organizer events never upload here, so a lost File[] means nothing
          to them — the banner stays scoped to the event types that upload. */}
      {photosLost && !isOrganizer && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('photosLostBanner')}</p>
        </div>
      )}

      {/* T-210: the cover moved here from step 3 (Details) — both controls on
          this step pick images, so they belong together. The split is
          deliberately lopsided: a narrow fixed column for the cover (one
          optional image) and everything else for the event photos, which are
          the point of the step. Stacks on mobile, cover first (compact) so it
          can't push the dropzone below the fold. */}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        {/* No `fill` here (unlike step 3's two-column layout): the box stays at
            its compact height so it never out-weighs the upload area. */}
        <EventCoverField
          previewUrl={coverPreviewUrl}
          onCoverChange={onCoverChange}
          labels={{
            label: t('coverLabel'),
            desc: t('coverDesc'),
            infoAria: t('coverInfoAria'),
            select: t('coverSelect'),
            remove: t('coverRemove'),
          }}
        />

        {/* Event photos. Organizer events don't upload their own, but they
            still need a cover (they're public and render on cards), so this
            is a branch inside the layout — never an early return (T-210). */}
        <div className="grid min-w-0 gap-4">
          {isOrganizer ? (
            <div className="flex items-start gap-3 rounded-lg border border-input bg-muted/30 p-4 text-sm">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="grid gap-1">
                <p className="font-medium">{t('organizerNoOwnPhotosTitle')}</p>
                <p className="text-muted-foreground">{t('organizerNoOwnPhotos')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>{t('addPhotosLabel')}</Label>
                <Dropzone
                  accept=".jpg,.jpeg,.png,.heic"
                  onSelect={onFiles}
                  className="min-h-48 rounded-lg"
                />
                {isCollaborative && previews.length < 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('collaborativePhotosOptional')}
                  </p>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              {previews.length > 0 && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
