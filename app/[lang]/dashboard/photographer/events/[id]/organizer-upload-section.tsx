'use client';

import { Loader2 } from 'lucide-react';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { uploadOrganizerEventPhotoAction } from './actions';

type OrganizerEventT = Dictionary['organizerEvent'];

type OrganizerUploadSectionProps = {
  eventId: string;
};

export function OrganizerUploadSection({ eventId }: OrganizerUploadSectionProps) {
  const { t } = useTranslations<OrganizerEventT>();
  const [isPending, startTransition] = useTransition();
  const inputId = useId();

  const [files, setFiles] = useState<File[]>([]);

  const submit = () => {
    if (files.length === 0) return;
    const formData = new FormData();
    formData.append('event_id', eventId);
    for (const file of files) formData.append('photos', file);
    startTransition(async () => {
      try {
        const result = await uploadOrganizerEventPhotoAction(formData);
        if (result.uploaded === 0 && result.skipped.length > 0) {
          toast.error(t('allPhotosSkippedStorageLimit'));
        } else if (result.skipped.length > 0) {
          toast.warning(
            t('nPhotosUploadedSomeSkipped')
              .replace('{uploaded}', String(result.uploaded))
              .replace('{skipped}', String(result.skipped.length)),
          );
        } else {
          toast.success(t('uploadSuccess').replace('{n}', String(result.uploaded)));
        }
        setFiles([]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('uploadFailed'));
      }
    });
  };

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <p className="mb-3 text-sm text-muted-foreground">{t('uploadAccepted')}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label
          htmlFor={inputId}
          className="flex flex-1 cursor-pointer items-center gap-3 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:border-primary/50"
        >
          <input
            id={inputId}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.heic"
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <span>{files.length === 0 ? t('uploadButton') : `${files.length} file(s)`}</span>
        </label>
        <Button type="button" onClick={submit} disabled={isPending || files.length === 0}>
          {isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {isPending ? t('uploadingButton') : t('uploadButton')}
        </Button>
      </div>
    </section>
  );
}
