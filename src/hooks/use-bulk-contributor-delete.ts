'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { deleteContributorPhotoAction } from '@/app/[lang]/events/[shareCode]/actions';

/** Localized copy for the bulk-delete flow on a collaborative event. */
export interface BulkContributorDeleteLabels {
  /** Selection-bar button label (e.g. "Remove"). */
  button: string;
  /** Confirmation dialog title. */
  confirmTitle: string;
  /** Confirmation dialog body — `{n}` + `{noun}` placeholders. */
  confirmDesc: string;
  confirmButton: string;
  cancelButton: string;
  /** Confirm button label while the delete is in flight. */
  deletingLabel: string;
  /** Toast on success — `{n}` + `{noun}`. */
  successToast: string;
  /** Toast when some selected photos weren't the viewer's — `{n}`, `{noun}`, `{m}`. */
  skippedToast: string;
  /** Toast when none of the selection was deletable by the viewer. */
  noneEligibleToast: string;
  /** Toast when the server rejected one or more deletes. */
  failedToast: string;
  /** Singular noun ("photo"). */
  photoNoun: string;
  /** Plural noun ("photos"). */
  photosNoun: string;
}

/**
 * Bulk delete of selected photos on a collaborative event. Reuses the
 * single-photo `deleteContributorPhotoAction` in a loop — the server
 * re-verifies ownership on every call, so the client-side eligibility filter
 * is purely a UX nicety. Guests pass their per-photo delete token; the server
 * ignores it for authenticated row owners.
 *
 * The caller owns the confirmation dialog and the eligibility filtering (so the
 * dialog can show the eligible count); this hook performs the deletes, surfaces
 * the result toasts, and reports which ids were removed so the grid can drop
 * those tiles optimistically.
 */
export function useBulkContributorDelete(args: {
  shareCode: string | null;
  labels: BulkContributorDeleteLabels;
  /** Per-photo guest delete token (guests only); undefined for authed users. */
  getDeleteToken?: (photoId: string) => string | undefined;
  /** Called with the ids that were actually deleted, for optimistic removal. */
  onDeleted: (ids: string[]) => void;
}) {
  const { shareCode, labels, getDeleteToken, onDeleted } = args;
  const [isDeleting, setIsDeleting] = useState(false);

  const noun = useCallback(
    (n: number) => (n === 1 ? labels.photoNoun : labels.photosNoun),
    [labels],
  );

  /**
   * Delete the given already-eligible ids. `skippedCount` is the number of
   * selected photos the caller filtered out as not the viewer's — surfaced in
   * the success toast.
   */
  const deleteEligible = useCallback(
    async (eligibleIds: string[], skippedCount: number) => {
      if (!shareCode || eligibleIds.length === 0 || isDeleting) return;
      setIsDeleting(true);
      // Promise.allSettled never rejects, so the only work in the try is the
      // awaited batch; the result-handling (toasts, optimistic removal) runs
      // after the spinner clears so a thrown "total failure" keeps the
      // confirm dialog open for retry.
      let deleted: string[] = [];
      try {
        const results = await Promise.allSettled(
          eligibleIds.map((photoId) =>
            deleteContributorPhotoAction({
              photoId,
              shareCode,
              deleteToken: getDeleteToken?.(photoId),
            }),
          ),
        );
        deleted = eligibleIds.filter((_, i) => results[i].status === 'fulfilled');
      } finally {
        setIsDeleting(false);
      }

      const failedCount = eligibleIds.length - deleted.length;
      if (deleted.length > 0) onDeleted(deleted);

      if (failedCount > 0) {
        toast.error(labels.failedToast);
        // Nothing deleted at all — surface as a thrown error so the confirm
        // dialog stays open. A partial success closes it (some tiles dropped).
        if (deleted.length === 0) throw new Error('Bulk delete failed.');
      } else if (skippedCount > 0) {
        toast.success(
          labels.skippedToast
            .replace('{n}', String(deleted.length))
            .replace('{noun}', noun(deleted.length))
            .replace('{m}', String(skippedCount)),
        );
      } else {
        toast.success(
          labels.successToast
            .replace('{n}', String(deleted.length))
            .replace('{noun}', noun(deleted.length)),
        );
      }
    },
    [shareCode, isDeleting, getDeleteToken, onDeleted, labels, noun],
  );

  /** Early-out toast when the whole selection is ineligible. */
  const notifyNoneEligible = useCallback(() => {
    toast.error(labels.noneEligibleToast);
  }, [labels]);

  return { isDeleting, deleteEligible, notifyNoneEligible };
}
