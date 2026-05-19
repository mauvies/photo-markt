/**
 * Client-side multipart upload utility for the direct-to-Supabase-Storage
 * flow. Used by every upload UI surface (wizard, organizer contributor,
 * edit-event, guest collaborative) so progress accounting, abort handling,
 * and concurrency are uniform.
 *
 * Why XHR instead of fetch:
 *   `fetch` does not surface upload progress events. The browser ships
 *   bytes but the API only resolves once everything is sent. XHR's
 *   `upload.onprogress` is the only standards-track way to render a
 *   real progress bar.
 *
 * No retry inside this module — caller-owned. The wizard wraps a "Retry
 * failed (N)" affordance around the `failed[]` return.
 */

export interface UploadTarget {
  file: File;
  path: string;
  signedUrl: string;
}

export interface UploadProgressInfo {
  /** Bytes transmitted so far for this single file. */
  loaded: number;
  /** Total bytes the file is expected to transmit. */
  total: number;
}

export interface UploadCallbacks {
  onFileStart?: (target: UploadTarget) => void;
  onFileProgress?: (target: UploadTarget, info: UploadProgressInfo) => void;
  onFileComplete?: (target: UploadTarget) => void;
  onFileFailed?: (target: UploadTarget, error: Error) => void;
  /** Aggregate progress in bytes across every target. */
  onOverallProgress?: (loaded: number, total: number) => void;
}

export interface UploadController {
  /**
   * Aborts every in-flight XHR. Files already complete remain in Storage
   * — the caller is expected to call `discardOrphanedUploads` for those.
   * Already-failed and not-yet-started targets are unaffected.
   */
  cancel: () => void;
}

export interface UploadSuccess {
  file: File;
  path: string;
  sizeBytes: number;
}

export interface UploadFailure {
  file: File;
  path: string;
  error: Error;
}

export interface UploadResult {
  succeeded: UploadSuccess[];
  failed: UploadFailure[];
  controller: UploadController;
}

const DEFAULT_CONCURRENCY = 5;

/**
 * Tiny p-limit. Why: ~25 LOC vs adding a 4 KB dependency for a single
 * call-site. Returns a function that, when called, schedules the task
 * and resolves with its result.
 */
function pLimit<T>(concurrency: number): (task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) {
      active += 1;
      job();
    }
  };

  return (task) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        task()
          .then((value) => {
            active -= 1;
            resolve(value);
            next();
          })
          .catch((err) => {
            active -= 1;
            reject(err);
            next();
          });
      };
      queue.push(run);
      next();
    });
}

interface PerFileState {
  target: UploadTarget;
  xhr: XMLHttpRequest;
  loaded: number;
}

/**
 * Upload many `UploadTarget`s in parallel (bounded concurrency). Resolves
 * once every target has settled (success, failure, or abort).
 */
export async function uploadPhotosWithProgress(
  targets: UploadTarget[],
  callbacks?: UploadCallbacks,
  options?: { concurrency?: number },
): Promise<UploadResult> {
  const limit = pLimit<void>(options?.concurrency ?? DEFAULT_CONCURRENCY);
  const succeeded: UploadSuccess[] = [];
  const failed: UploadFailure[] = [];
  const states = new Map<UploadTarget, PerFileState>();

  const totalBytes = targets.reduce((acc, t) => acc + t.file.size, 0);
  const reportAggregate = () => {
    if (!callbacks?.onOverallProgress) return;
    let loaded = 0;
    for (const state of states.values()) {
      loaded += state.loaded;
    }
    callbacks.onOverallProgress(loaded, totalBytes);
  };

  const controller: UploadController = {
    cancel: () => {
      for (const state of states.values()) {
        // Idempotent — XHR.abort() on a completed request is a no-op.
        try {
          state.xhr.abort();
        } catch {
          // best-effort
        }
      }
    },
  };

  const runOne = (target: UploadTarget): Promise<void> =>
    new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const state: PerFileState = { target, xhr, loaded: 0 };
      states.set(target, state);

      let settled = false;
      const settle = (result: 'success' | 'failure', error?: Error) => {
        if (settled) return;
        settled = true;
        if (result === 'success') {
          state.loaded = target.file.size; // pin progress at 100% for the aggregate
          succeeded.push({ file: target.file, path: target.path, sizeBytes: target.file.size });
          callbacks?.onFileComplete?.(target);
        } else {
          const finalError =
            error ?? new Error(`Upload failed for ${target.file.name} (status ${xhr.status})`);
          failed.push({ file: target.file, path: target.path, error: finalError });
          callbacks?.onFileFailed?.(target, finalError);
        }
        reportAggregate();
        resolve();
      };

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          state.loaded = event.loaded;
        }
        callbacks?.onFileProgress?.(target, {
          loaded: state.loaded,
          total: target.file.size,
        });
        reportAggregate();
      });
      xhr.addEventListener('load', () => {
        // Supabase signed-upload returns 200 on success, 4xx/5xx otherwise.
        if (xhr.status >= 200 && xhr.status < 300) {
          settle('success');
        } else {
          settle(
            'failure',
            new Error(`Upload rejected by Storage (HTTP ${xhr.status}): ${xhr.responseText}`),
          );
        }
      });
      xhr.addEventListener('error', () => {
        settle('failure', new Error('Network error during upload.'));
      });
      xhr.addEventListener('abort', () => {
        const err = new Error('Upload aborted by user.');
        err.name = 'AbortError';
        settle('failure', err);
      });
      xhr.addEventListener('timeout', () => {
        settle('failure', new Error('Upload timed out.'));
      });

      callbacks?.onFileStart?.(target);
      xhr.open('PUT', target.signedUrl, true);
      if (target.file.type) {
        xhr.setRequestHeader('Content-Type', target.file.type);
      }
      xhr.send(target.file);
    });

  await Promise.all(targets.map((target) => limit(() => runOne(target))));

  return { succeeded, failed, controller };
}
