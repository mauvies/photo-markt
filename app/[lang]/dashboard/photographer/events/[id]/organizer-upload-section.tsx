'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { usePhotoUpload } from '@/lib/use-photo-upload';

type OrganizerEventT = Dictionary['organizerEvent'];
type NewEventT = Dictionary['newEvent'];

type OrganizerUploadSectionProps = {
  eventId: string;
};

export function OrganizerUploadSection({ eventId }: OrganizerUploadSectionProps) {
  const { t } = useTranslations<OrganizerEventT>();
  // Sharing the upload-modal labels with the wizard avoids re-defining keys.
  const { t: tNew } = useTranslations<NewEventT>();
  const router = useRouter();
  const inputId = useId();
  const upload = usePhotoUpload();

  const [files, setFiles] = useState<File[]>([]);

  const submit = async () => {
    if (files.length === 0 || upload.isActive) return;
    try {
      const result = await upload.run({ eventId, files });
      if (result.failed.length === 0) {
        const succeeded = result.attached.length;
        toast.success(t('uploadSuccess').replace('{n}', String(succeeded)));
        setFiles([]);
        upload.reset();
        // Push with ?uploaded so the page can render the rejected toast
        // when the worker rejects bytes server-side.
        router.replace(`?uploaded=${succeeded}`);
        router.refresh();
      }
      // Partial-failed handled by the dialog's Retry/Close.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    }
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
        <Button type="button" onClick={submit} disabled={upload.isActive || files.length === 0}>
          {upload.isActive ? t('uploadingButton') : t('uploadButton')}
        </Button>
      </div>

      <UploadProgressDialog
        stage={upload.stage}
        progressBytes={upload.progressBytes}
        totalBytes={upload.totalBytes}
        completedCount={upload.completedCount}
        totalCount={upload.totalCount}
        failedCount={upload.failedCount}
        errorMessage={upload.errorMessage}
        labels={{
          title: tNew('uploadProgressTitle' as keyof NewEventT),
          preparing: tNew('uploadStatePreparing' as keyof NewEventT),
          uploading: tNew('uploadStateUploading' as keyof NewEventT),
          finalizing: tNew('uploadStateFinalizing' as keyof NewEventT),
          done: tNew('uploadStateDone' as keyof NewEventT),
          partialFailed: tNew('uploadStatePartialFailed' as keyof NewEventT),
          errorTitle: tNew('uploadStateError' as keyof NewEventT),
          cancelButton: tNew('uploadCancelButton' as keyof NewEventT),
          closeButton: tNew('uploadCloseButton' as keyof NewEventT),
          retryFailedButton: tNew('uploadRetryFailedButton' as keyof NewEventT),
        }}
        onCancel={() => void upload.cancel()}
        onRetryFailed={() => void upload.retryFailed()}
        onClose={() => {
          const succeeded = upload.completedCount - upload.failedCount;
          if (succeeded > 0) {
            router.replace(`?uploaded=${succeeded}`);
            router.refresh();
          }
          setFiles([]);
          upload.reset();
        }}
      />
    </section>
  );
}
