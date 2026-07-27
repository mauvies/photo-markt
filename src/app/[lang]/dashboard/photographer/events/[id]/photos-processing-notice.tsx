import { Loader2 } from 'lucide-react';

interface PhotosProcessingNoticeProps {
  /** Photos still `pending` (uploaded but not yet promoted to `approved`). */
  pendingCount: number;
  /** Photos already `approved` — the count publicly visible on the event page. */
  approvedCount: number;
  labels: {
    /** Template for exactly one pending photo. `{approved}` / `{total}`. */
    processingOne: string;
    /** Template for many pending photos. `{pending}` / `{approved}` / `{total}`. */
    processingMany: string;
  };
}

/**
 * Solo-event dashboard notice (T-174). The photographer's grid mixes `approved`
 * and still-`pending` uploads under a single "N photos" total, so when the
 * face-indexing worker hasn't promoted uploads to `approved` yet (in-flight, or
 * the worker isn't running), "N photos" silently disagrees with the public
 * event page (which shows approved-only). This spells out how many are live vs
 * still processing so the gap reads as expected, not as a lost-photos bug.
 *
 * Renders nothing when nothing is pending.
 */
export function PhotosProcessingNotice({
  pendingCount,
  approvedCount,
  labels,
}: PhotosProcessingNoticeProps) {
  if (pendingCount <= 0) return null;
  const total = approvedCount + pendingCount;
  const text = (pendingCount === 1 ? labels.processingOne : labels.processingMany)
    .replace('{pending}', String(pendingCount))
    .replace('{approved}', String(approvedCount))
    .replace('{total}', String(total));

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200"
      role="status"
    >
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <span>{text}</span>
    </div>
  );
}
