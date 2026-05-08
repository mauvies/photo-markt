'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { uploadGuestPhotosAction } from './actions';
import { appendGuestUploads } from './guest-uploads-storage';

type Labels = {
  successApproved: string;
  successPending: string;
  errorGeneric: string;
};

type TriggerArgs = {
  formData: FormData;
  isAuthenticated: boolean;
  shareCode: string;
};

type ContextValue = {
  /** True while an upload is in flight. The viewer renders an overlay. */
  isUploading: boolean;
  /** Number of photos currently being uploaded (for "Uploading N…" copy). */
  uploadingCount: number;
  /**
   * Kick off the upload. Resolves once the underlying action has run; callers
   * usually fire-and-forget so the modal can close synchronously and the
   * gallery overlay takes over.
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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  const triggerUpload = useCallback(
    async ({ formData, isAuthenticated, shareCode }: TriggerArgs) => {
      const fileCount = formData.getAll('photos').length;
      setUploadingCount(fileCount);
      setIsUploading(true);
      try {
        const result = await uploadGuestPhotosAction(formData);
        if (!isAuthenticated) {
          appendGuestUploads(shareCode, result.uploads);
        }
        toast.success(result.status === 'pending' ? labels.successPending : labels.successApproved);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : labels.errorGeneric);
      } finally {
        setIsUploading(false);
        setUploadingCount(0);
      }
    },
    [router, labels],
  );

  const value = useMemo(
    () => ({ isUploading, uploadingCount, triggerUpload }),
    [isUploading, uploadingCount, triggerUpload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
