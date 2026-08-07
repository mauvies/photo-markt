import { ScanFace, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface GatedSearchPanelLabels {
  /** Searchable: the event is indexed and the visitor can search now. */
  searchTitle: string;
  searchDescription: string;
  searchCta: string;
  /** `{count}` is replaced with the event's total photo count. */
  photoCount: string;
  privacyNote: string;
  /** Indexing still running — nothing to search against yet. */
  processingTitle: string;
  processingDescription: string;
  /** Indexing failed, or the event has nothing searchable. */
  unavailableTitle: string;
  unavailableDescription: string;
}

export type GatedSearchPanelState = 'searchable' | 'processing' | 'unavailable';

/**
 * The whole screen for a reveal-gated event before the visitor has searched
 * (T-230).
 *
 * On a gated event this panel **is the product**: the gallery is not browsable
 * by design (T-177), so if the visitor doesn't search they see nothing and buy
 * nothing. It previously rendered as a single muted line of text inside the
 * gallery slot, with the actual search button in a separate banner above it —
 * so the copy had to say "take a selfie *above*", which is the tell that the
 * call to action was in the wrong place. The page read as empty.
 *
 * One panel now owns all three pre-search states, so a gated event can no longer
 * render three different visual weights depending on whether its index happens
 * to be ready:
 *
 * | state          | what it means                          | has a CTA |
 * |----------------|----------------------------------------|-----------|
 * | `searchable`   | indexed; the visitor can search now     | yes       |
 * | `processing`   | indexing in flight; nothing to match on  | no        |
 * | `unavailable`  | indexing failed / nothing searchable     | no        |
 *
 * ⚠️ **Presentation only — this must never loosen the gate.** The security
 * property of T-177 is that an unproven visitor receives no photo IDs and no
 * photo URLs. The panel therefore shows nothing derived from individual photos:
 * no thumbnails, no per-photo counts. The event TOTAL is deliberately fine (it
 * is already rendered beside the header on gated events) and is the one true
 * fact that makes searching worth it, which is why it anchors the panel.
 */
export function GatedSearchPanel({
  state,
  labels,
  photoCount,
  onSearch,
}: {
  state: GatedSearchPanelState;
  labels: GatedSearchPanelLabels;
  /** Event total. Omitted when unknown — the panel simply drops the line. */
  photoCount?: number | null;
  /** Required for `searchable`; ignored otherwise. */
  onSearch?: () => void;
}) {
  const isSearchable = state === 'searchable';
  const isProcessing = state === 'processing';
  const Icon = isSearchable ? ScanFace : isProcessing ? ScanFace : TriangleAlert;

  const title = isSearchable
    ? labels.searchTitle
    : isProcessing
      ? labels.processingTitle
      : labels.unavailableTitle;
  const description = isSearchable
    ? labels.searchDescription
    : isProcessing
      ? labels.processingDescription
      : labels.unavailableDescription;

  const showCount = isSearchable && typeof photoCount === 'number' && photoCount > 0;

  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center sm:px-10 sm:py-16">
      <span
        className="mb-5 flex size-14 items-center justify-center rounded-full bg-muted"
        aria-hidden
      >
        <Icon
          className={
            isProcessing
              ? 'size-7 animate-pulse text-muted-foreground'
              : 'size-7 text-muted-foreground'
          }
        />
      </span>

      <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h3>

      {showCount ? (
        // The one true number we can show without leaking anything about which
        // photos exist — and the reason to bother searching.
        <p className="mt-2 text-sm font-medium text-foreground">
          {labels.photoCount.replace('{count}', String(photoCount))}
        </p>
      ) : null}

      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>

      {isSearchable && onSearch ? (
        <>
          <div className="my-7 h-px w-full max-w-xs bg-border" />
          <Button size="lg" onClick={onSearch}>
            <ScanFace className="mr-2 size-4" aria-hidden />
            {labels.searchCta}
          </Button>
          <p className="mt-5 flex max-w-sm items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{labels.privacyNote}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}
