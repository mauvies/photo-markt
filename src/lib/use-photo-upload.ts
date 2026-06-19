'use client';

import { useCallback, useRef, useState } from 'react';
import {
  attachPhotosToEvent,
  createPhotoUploadUrls,
  discardOrphanedUploads,
} from '@/app/[lang]/dashboard/photographer/events/[id]/upload-urls/actions';
import {
  type UploadController,
  type UploadFailure,
  type UploadSuccess,
  uploadPhotosWithProgress,
} from '@/lib/photo-upload-client';

export type UploadStage =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'partial-failed'
  | 'error'
  | 'cancelled';

export interface UploadFlowOptions {
  eventId: string;
  files: File[];
  /** Guest collaborative flow: pass the event's share_code. */
  shareCode?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
}

export interface AttachedPhoto {
  id: string;
  path: string;
  deleteToken: string | null;
}

export interface UploadFlowResult {
  /** Photos the client successfully attached. Same shape across flows. */
  attached: AttachedPhoto[];
  /** Files that never finished uploading (network error, abort, etc.). */
  failed: UploadFailure[];
  /** Files that uploaded but failed to insert a row. */
  insertSkipped: Array<{ path: string; reason: string }>;
}

export interface UsePhotoUploadReturn {
  stage: UploadStage;
  /** Aggregate bytes uploaded so far across the batch. */
  progressBytes: number;
  /** Total bytes the batch is expected to transmit. */
  totalBytes: number;
  /** Number of files that have completed (or failed) so far. */
  completedCount: number;
  totalCount: number;
  failedCount: number;
  errorMessage: string | null;
  isActive: boolean;

  /** Kick off the upload. Resolves with the final result once everything
   *  has settled (success, failure, abort). */
  run: (options: UploadFlowOptions) => Promise<UploadFlowResult>;

  /** Abort in-flight uploads and discard already-uploaded orphans. The
   *  modal should resolve to `cancelled`. */
  cancel: () => Promise<void>;

  /** Retry just the files that failed in the previous run. New signed
   *  URLs are minted for each. */
  retryFailed: () => Promise<UploadFlowResult | null>;

  reset: () => void;
}

interface InternalState {
  options: UploadFlowOptions | null;
  controller: UploadController | null;
  uploadedPaths: string[];
  lastFailedFiles: File[];
}

export function usePhotoUpload(): UsePhotoUploadReturn {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progressBytes, setProgressBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stateRef = useRef<InternalState>({
    options: null,
    controller: null,
    uploadedPaths: [],
    lastFailedFiles: [],
  });

  const reset = useCallback(() => {
    setStage('idle');
    setProgressBytes(0);
    setTotalBytes(0);
    setCompletedCount(0);
    setTotalCount(0);
    setFailedCount(0);
    setErrorMessage(null);
    stateRef.current = {
      options: null,
      controller: null,
      uploadedPaths: [],
      lastFailedFiles: [],
    };
  }, []);

  const runInternal = useCallback(async (options: UploadFlowOptions): Promise<UploadFlowResult> => {
    const { eventId, files, shareCode, guestName, guestEmail } = options;
    stateRef.current.options = options;
    stateRef.current.uploadedPaths = [];
    stateRef.current.lastFailedFiles = [];

    setErrorMessage(null);
    setTotalCount(files.length);
    setCompletedCount(0);
    setFailedCount(0);
    setProgressBytes(0);
    setTotalBytes(files.reduce((acc, f) => acc + f.size, 0));

    // ─── Stage 1: mint signed upload URLs ─────────────────────────────────
    setStage('preparing');
    const CHUNK_SIZE = 100;
    const fileMeta = files.map((f) => ({
      originalFilename: f.name,
      sizeBytes: f.size,
      mimeType: f.type,
    }));
    const urlChunks: Awaited<ReturnType<typeof createPhotoUploadUrls>>['uploads'] = [];
    for (let i = 0; i < fileMeta.length; i += CHUNK_SIZE) {
      const chunk = await createPhotoUploadUrls({
        eventId,
        files: fileMeta.slice(i, i + CHUNK_SIZE),
        shareCode: shareCode ?? null,
        guestName: guestName ?? null,
        guestEmail: guestEmail ?? null,
      });
      urlChunks.push(...chunk.uploads);
    }
    const uploads = urlChunks;
    if (uploads.length !== files.length) {
      throw new Error('Mismatch between requested files and signed URLs.');
    }

    // ─── Stage 2: PUT bytes ──────────────────────────────────────────────
    setStage('uploading');
    const targets = files.map((file, i) => ({
      file,
      path: uploads[i].path,
      signedUrl: uploads[i].signedUrl,
    }));

    let succeeded: UploadSuccess[] = [];
    let failed: UploadFailure[] = [];

    const result = await uploadPhotosWithProgress(targets, {
      onOverallProgress: (loaded) => setProgressBytes(loaded),
      onFileComplete: () => setCompletedCount((n) => n + 1),
      onFileFailed: () => {
        setCompletedCount((n) => n + 1);
        setFailedCount((n) => n + 1);
      },
    });
    stateRef.current.controller = result.controller;
    succeeded = result.succeeded;
    failed = result.failed;
    stateRef.current.uploadedPaths = succeeded.map((s) => s.path);
    stateRef.current.lastFailedFiles = failed.map((f) => f.file);

    // ─── Stage 3: attach photos (with retry) ─────────────────────────────
    setStage('finalizing');
    const attached: AttachedPhoto[] = [];
    const insertSkipped: Array<{ path: string; reason: string }> = [];

    if (succeeded.length > 0) {
      const photoMeta = succeeded.map((s) => ({
        path: s.path,
        originalFilename: s.file.name,
        sizeBytes: s.sizeBytes,
      }));
      const backoffs = [500, 1500, 4000];
      for (let i = 0; i < photoMeta.length; i += CHUNK_SIZE) {
        const chunk = photoMeta.slice(i, i + CHUNK_SIZE);
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
          try {
            const attachResult = await attachPhotosToEvent({
              eventId,
              shareCode: shareCode ?? null,
              guestName: guestName ?? null,
              guestEmail: guestEmail ?? null,
              photos: chunk,
            });
            attached.push(
              ...attachResult.inserted.map((row) => ({
                id: row.id,
                path: row.path,
                deleteToken: row.deleteToken,
              })),
            );
            insertSkipped.push(...attachResult.skipped);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < backoffs.length - 1) {
              await new Promise<void>((resolve) => setTimeout(resolve, backoffs[attempt]));
            }
          }
        }
        if (lastErr) throw lastErr;
      }
    }

    // ─── Final stage ─────────────────────────────────────────────────────
    if (failed.length > 0) {
      setStage('partial-failed');
    } else {
      setStage('done');
    }

    return { attached, failed, insertSkipped };
  }, []);

  const run = useCallback(
    async (options: UploadFlowOptions): Promise<UploadFlowResult> => {
      try {
        return await runInternal(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        setErrorMessage(message);
        setStage('error');
        throw err;
      }
    },
    [runInternal],
  );

  const retryFailed = useCallback(async (): Promise<UploadFlowResult | null> => {
    const { options, lastFailedFiles } = stateRef.current;
    if (!options || lastFailedFiles.length === 0) return null;
    try {
      const result = await runInternal({ ...options, files: lastFailedFiles });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed.';
      setErrorMessage(message);
      setStage('error');
      throw err;
    }
  }, [runInternal]);

  const cancel = useCallback(async () => {
    const { options, controller, uploadedPaths } = stateRef.current;
    controller?.cancel();
    setStage('cancelled');
    if (options && uploadedPaths.length > 0) {
      try {
        await discardOrphanedUploads({
          eventId: options.eventId,
          shareCode: options.shareCode ?? null,
          paths: uploadedPaths,
        });
      } catch (err) {
        // Best-effort — the Inngest cron sweeps within 30 min.
        console.error('[usePhotoUpload] discardOrphanedUploads failed', err);
      }
    }
  }, []);

  return {
    stage,
    progressBytes,
    totalBytes,
    completedCount,
    totalCount,
    failedCount,
    errorMessage,
    isActive: stage !== 'idle' && stage !== 'done' && stage !== 'error' && stage !== 'cancelled',
    run,
    cancel,
    retryFailed,
    reset,
  };
}
