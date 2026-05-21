'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { BulkDownloadLabels } from '@/components/photo-selection-toolbar';
import { downloadEventPhotosZip } from '@/lib/download-zip';

/**
 * Bulk ZIP download of selected event photos — shared by the event viewers and
 * the AI face-search results view. On a paid event the selection is filtered
 * to purchased photos before the request and the skipped count is toasted; the
 * server re-verifies permission regardless.
 */
export function useBulkPhotoDownload(args: {
  eventId: string;
  isFreeEvent: boolean;
  purchasedPhotoIds: Set<string>;
  bulkDownload: BulkDownloadLabels;
}) {
  const { eventId, isFreeEvent, purchasedPhotoIds, bulkDownload } = args;
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadSelected = useCallback(
    async (selectedIds: string[]) => {
      if (selectedIds.length === 0 || isDownloading) return;
      const downloadable = isFreeEvent
        ? selectedIds
        : selectedIds.filter((id) => purchasedPhotoIds.has(id));
      const skipped = selectedIds.length - downloadable.length;
      if (downloadable.length === 0) {
        toast.error(bulkDownload.nonePurchased);
        return;
      }
      setIsDownloading(true);
      try {
        await downloadEventPhotosZip(eventId, downloadable);
        if (skipped > 0) {
          toast.success(
            bulkDownload.skipped
              .replace('{n}', String(downloadable.length))
              .replace('{m}', String(skipped)),
          );
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : bulkDownload.failed);
      } finally {
        setIsDownloading(false);
      }
    },
    [eventId, isFreeEvent, purchasedPhotoIds, bulkDownload, isDownloading],
  );

  return { isDownloading, downloadSelected };
}
