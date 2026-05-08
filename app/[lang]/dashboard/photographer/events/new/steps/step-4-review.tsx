'use client';

import { AlertTriangle, Pencil } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import type { StepNumber } from '../components/wizard-steps';
import type { EventType } from '../wizard.schema';
import type { FilePreview } from '../wizard-types';

type NewEventT = Dictionary['newEvent'];

export type ReviewSection = {
  title: string;
  editStep: StepNumber;
  rows: Array<{ label: string; value: string }>;
};

type Step4ReviewProps = {
  sections: ReviewSection[];
  previews: FilePreview[];
  // Shown when previews are empty due to a refresh wiping File[] state.
  // Disables the final submit by way of the parent (we just render the banner).
  photosLost: boolean;
  eventType: EventType;
  goToStep: (step: StepNumber) => void;
};

export function Step4Review({
  sections,
  previews,
  photosLost,
  eventType,
  goToStep,
}: Step4ReviewProps) {
  const { t } = useTranslations<NewEventT>();
  const isOrganizer = eventType === 'organizer';

  return (
    <div className="grid gap-4">
      {photosLost && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{t('photosLostBanner')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => goToStep(3)}
            >
              {t('reviewEditPhotos')}
            </Button>
          </div>
        </div>
      )}

      {sections.map((section) => (
        <section key={section.title} className="rounded-lg border bg-card p-4">
          <header className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => goToStep(section.editStep)}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              {t('wizardEdit')}
            </Button>
          </header>
          <dl className="grid gap-1.5 text-sm">
            {section.rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-right font-medium">{row.value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="rounded-lg border bg-card p-4">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('reviewPhotosSection')}</h3>
          {!isOrganizer && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => goToStep(3)}
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              {t('wizardEdit')}
            </Button>
          )}
        </header>
        {previews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOrganizer ? t('organizerNoOwnPhotos') : t('reviewNoPhotos')}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('summaryPhotosCount').replace('{n}', String(previews.length))}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {previews.map((preview) => (
                <div
                  key={preview.id}
                  className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                >
                  <Image
                    src={preview.url}
                    alt={`Preview ${preview.file.name}`}
                    fill
                    sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 14vw"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
