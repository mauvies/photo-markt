import { ScanFace, TriangleAlert } from 'lucide-react';
import type { GatedFaceSearchNotice as GatedFaceSearchNoticeState } from '@/lib/find-my-photos';

export interface GatedFaceSearchNoticeLabels {
  processingTitle: string;
  processingDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
}

/**
 * Reveal gate (T-177) dead-end guard (T-184). A gated event reveals its photos
 * only through a face-search match, so when the event isn't searchable yet
 * (nothing indexed / indexing in flight / indexing failed) the visitor would
 * otherwise be stranded with no photos and no search entry. This renders a
 * clear "still processing" or "unavailable" state in that gap instead of a mute
 * empty gallery.
 *
 * `state` is `'processing'` or `'unavailable'` — the caller resolves it via
 * `resolveGatedFaceSearchNotice` and never renders this for the `'none'` case.
 */
export function GatedFaceSearchNotice({
  state,
  labels,
}: {
  state: Exclude<GatedFaceSearchNoticeState, 'none'>;
  labels: GatedFaceSearchNoticeLabels;
}) {
  const isProcessing = state === 'processing';
  const Icon = isProcessing ? ScanFace : TriangleAlert;
  const title = isProcessing ? labels.processingTitle : labels.unavailableTitle;
  const description = isProcessing ? labels.processingDescription : labels.unavailableDescription;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Icon className="mb-6 h-16 w-16 text-muted-foreground/50" aria-hidden />
      <h3 className="text-2xl font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">{description}</p>
    </div>
  );
}
