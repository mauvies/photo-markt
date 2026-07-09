'use client';

import { ScanText, Sparkles, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { searchPhotosByBibInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import type { BibSearchResult } from '@/components/event-gallery-with-face-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type FindMyPhotosCopyLabels, resolveFindMyPhotosCopy } from '@/lib/find-my-photos';

export interface FindMyPhotosLabels extends FindMyPhotosCopyLabels {
  /** Button labels. */
  faceButton: string;
  bibButton: string;
  /** Inline bib-search form. */
  bibPlaceholder: string;
  bibSearch: string;
  bibClear: string;
  bibFailed: string;
}

interface FindMyPhotosBannerProps {
  labels: FindMyPhotosLabels;
  /** Face-search affordance. Omit to hide the face button. */
  face?: {
    /** `'ready'` or `'indexing'` — only changes the header copy. */
    state: 'ready' | 'indexing';
    onOpen: () => void;
  };
  /** Bib-search affordance. Omit to hide the bib button. */
  bib?: {
    shareCode: string;
    onResults: (result: BibSearchResult | null) => void;
    hasResults: boolean;
  };
}

/**
 * Unified "Find my photos" card shown above the event gallery. Merges the AI
 * face-search invite and the bib-number search into one section: header copy on
 * the left, one button per enabled capability on the right (side by side on
 * desktop, wrapping on mobile). The face button opens the selfie modal; the bib
 * button reveals an inline numeric search that filters the grid in place.
 *
 * The parent (`EventGalleryWithFaceSearch`) decides whether to render this at
 * all and which capabilities to pass — see `resolveFindMyPhotos`.
 */
export function FindMyPhotosBanner({ labels, face, bib }: FindMyPhotosBannerProps) {
  const [bibOpen, setBibOpen] = useState(false);
  const [bibValue, setBibValue] = useState('');
  const [isPending, startTransition] = useTransition();

  // Keep the bib form visible whenever a search is active, so the Clear
  // affordance is always reachable even after a re-render.
  const bibExpanded = Boolean(bib) && (bibOpen || bib?.hasResults === true);

  const runBibSearch = () => {
    if (!bib) return;
    const value = bibValue.trim();
    if (!value) return;
    startTransition(async () => {
      try {
        const result = await searchPhotosByBibInEvent(bib.shareCode, value);
        bib.onResults({ photoIds: result.photoIds, matchedPhotos: result.matchedPhotos });
      } catch {
        // Includes the rate-limit signal — a single generic message is fine here.
        toast.error(labels.bibFailed);
      }
    });
  };

  const clearBib = () => {
    setBibValue('');
    setBibOpen(false);
    bib?.onResults(null);
  };

  const { title, description } = resolveFindMyPhotosCopy(labels, {
    hasFace: Boolean(face),
    hasBib: Boolean(bib),
    indexing: face?.state === 'indexing',
  });

  return (
    <div className="sm:mb-4 flex flex-col gap-3 rounded-lg border border-input bg-card p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold md:text-lg">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {face ? (
            <Button type="button" onClick={face.onOpen}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              {labels.faceButton}
            </Button>
          ) : null}
          {bib ? (
            <Button
              type="button"
              variant={face ? 'outline' : 'default'}
              aria-expanded={bibExpanded}
              onClick={() => setBibOpen((open) => !open)}
            >
              <ScanText className="mr-2 h-4 w-4" aria-hidden="true" />
              {labels.bibButton}
            </Button>
          ) : null}
        </div>
      </div>

      {bib && bibExpanded ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runBibSearch();
          }}
        >
          <Input
            autoFocus
            inputMode="numeric"
            value={bibValue}
            onChange={(e) => setBibValue(e.target.value)}
            placeholder={labels.bibPlaceholder}
            aria-label={labels.bibButton}
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={isPending || !bibValue.trim()}>
            {labels.bibSearch}
          </Button>
          {bib.hasResults ? (
            <Button type="button" variant="outline" size="sm" onClick={clearBib}>
              <X className="mr-1 h-4 w-4" />
              {labels.bibClear}
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
