'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { UploadProgressDialog } from '@/components/upload-progress-dialog';
import { usePhotoUpload } from '@/lib/use-photo-upload';
import { appendGuestUploads } from './guest-uploads-storage';

type Labels = {
  successApproved: string;
  successPending: string;
  errorGeneric: string;
  /** Toast shown when some files uploaded but others were skipped due to the
   *  event owner's storage limit. Template: replaces {uploaded}/{skipped}. */
  storageLimitPartial: string;
  /** Toast shown when every file was skipped — owner is out of space. */
  storageLimitAll: string;
  /** Upload-progress modal labels — shared by every direct-upload flow. */
  progressTitle: string;
  progressPreparing: string;
  progressUploading: string;
  progressFinalizing: string;
  progressDone: string;
  progressPartialFailed: string;
  progressError: string;
  cancelButton: string;
  closeButton: string;
  retryFailedButton: string;
};

type TriggerArgs = {
  eventId: string;
  files: File[];
  isAuthenticated: boolean;
  shareCode: string;
  guestName?: string | null;
  guestEmail?: string | null;
  /** Whether the event requires owner approval — used to pick the toast copy. */
  requireApproval?: boolean;
};

type ContextValue = {
  isUploading: boolean;
  uploadingCount: number;
  /**
   * Kick off the upload. The provider owns the upload modal and Cancel /
   * Retry handling, so callers fire-and-forget.
   */
  triggerUpload: (args: TriggerArgs) => Promise<void>;
};

const Ctx = createContext<ContextValue | null>(null);

export function UploadProgressProvider({
  children,
  labels,
}: {
  children: ReactNode;
  labels: Labels;
}) {
  const router = useRouter();
  const upload = usePhotoUpload();
  const [uploadingCount, setUploadingCount] = useState(0);
  const [pendingShareCode, setPendingShareCode] = useState<string | null>(null);
  const [pendingRequireApproval, setPendingRequireApproval] = useState(false);
  const [pendingIsAuthenticated, setPendingIsAuthenticated] = useState(false);

  const triggerUpload = useCallback(
    async ({
      eventId,
      files,
      isAuthenticated,
      shareCode,
      guestName,
      guestEmail,
      requireApproval,
    }: TriggerArgs) => {
      setUploadingCount(files.length);
      setPendingShareCode(shareCode);
      setPendingRequireApproval(Boolean(requireApproval));
      setPendingIsAuthenticated(isAuthenticated);
      try {
        const result = await upload.run({
          eventId,
          files,
          shareCode,
          guestName: guestName ?? null,
          guestEmail: guestEmail ?? null,
        });
        // Persist guest delete tokens for anonymous contributors so they can
        // delete their own photos later.
        if (!isAuthenticated) {
          const uploads = result.attached.map((row) => ({
            photoId: row.id,
            deleteToken: row.deleteToken,
          }));
          appendGuestUploads(shareCode, uploads);
        }
        if (result.failed.length === 0) {
          toast.success(requireApproval ? labels.successPending : labels.successApproved);
          router.refresh();
        }
        // partial-failed / error handled by the dialog
      } catch (err) {
        toast.error(err instanceof Error ? err.message : labels.errorGeneric);
      } finally {
        setUploadingCount(0);
      }
    },
    [labels, router, upload],
  );

  const value = useMemo(
    () => ({ isUploading: upload.isActive, uploadingCount, triggerUpload }),
    [upload.isActive, uploadingCount, triggerUpload],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <UploadProgressDialog
        stage={upload.stage}
        progressBytes={upload.progressBytes}
        totalBytes={upload.totalBytes}
        completedCount={upload.completedCount}
        totalCount={upload.totalCount}
        failedCount={upload.failedCount}
        errorMessage={upload.errorMessage}
        labels={{
          title: labels.progressTitle,
          preparing: labels.progressPreparing,
          uploading: labels.progressUploading,
          finalizing: labels.progressFinalizing,
          done: labels.progressDone,
          partialFailed: labels.progressPartialFailed,
          errorTitle: labels.progressError,
          cancelButton: labels.cancelButton,
          closeButton: labels.closeButton,
          retryFailedButton: labels.retryFailedButton,
        }}
        onCancel={() => void upload.cancel()}
        onRetryFailed={() => void upload.retryFailed()}
        onClose={() => {
          if (upload.stage === 'done' || upload.stage === 'partial-failed') {
            toast.success(pendingRequireApproval ? labels.successPending : labels.successApproved);
            router.refresh();
          }
          void pendingShareCode;
          void pendingIsAuthenticated;
          upload.reset();
        }}
      />
    </Ctx.Provider>
  );
}

export function useUploadProgress(): ContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useUploadProgress must be used within an UploadProgressProvider');
  }
  return v;
}

/**
 * Same as `useUploadProgress` but returns null when no provider is mounted.
 * Used by components that may render in contexts without an upload flow
 * (e.g. the photographer dashboard). When null, callers should treat it as
 * "no upload in progress".
 */
export function useOptionalUploadProgress(): ContextValue | null {
  return useContext(Ctx);
}
