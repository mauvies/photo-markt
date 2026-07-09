'use client';

import { ScanText, Sparkles, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { searchPhotosByBibInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import type { BibSearchResult } from '@/components/event-gallery-with-face-search';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type FindMyPhotosCopyLabels, resolveFindMyPhotosCopy } from '@/lib/find-my-photos';

export interface FindMyPhotosLabels extends FindMyPhotosCopyLabels {
  /** Button labels. */
  faceButton: string;
  bibButton: string;
  /** Bib-search modal. */
  bibModalTitle: string;
  bibModalDescription: string;
  bibPlaceholder: string;
  bibSearch: string;
  bibCancel: string;
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
 * button opens a small modal with a numeric input that filters the grid in
 * place. Once a bib search is active, a Clear button appears next to it.
 *
 * The bib input lives in a modal (not inline) so activating it never changes
 * the card's height — the inline form used to push the gallery down (T-081).
 *
 * The parent (`EventGalleryWithFaceSearch`) decides whether to render this at
 * all and which capabilities to pass — see `resolveFindMyPhotos`.
 */
export function FindMyPhotosBanner({ labels, face, bib }: FindMyPhotosBannerProps) {
  const [bibModalOpen, setBibModalOpen] = useState(false);
  const [bibValue, setBibValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const runBibSearch = () => {
    if (!bib) return;
    const value = bibValue.trim();
    if (!value) return;
    startTransition(async () => {
      try {
        const result = await searchPhotosByBibInEvent(bib.shareCode, value);
        bib.onResults({ photoIds: result.photoIds, matchedPhotos: result.matchedPhotos });
        setBibModalOpen(false);
      } catch {
        // Includes the rate-limit signal — a single generic message is fine here.
        toast.error(labels.bibFailed);
      }
    });
  };

  const clearBib = () => {
    setBibValue('');
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
              onClick={() => setBibModalOpen(true)}
            >
              <ScanText className="mr-2 h-4 w-4" aria-hidden="true" />
              {labels.bibButton}
            </Button>
          ) : null}
          {bib?.hasResults ? (
            <Button type="button" variant="outline" onClick={clearBib}>
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              {labels.bibClear}
            </Button>
          ) : null}
        </div>
      </div>

      {bib ? (
        <Dialog
          open={bibModalOpen}
          onOpenChange={(next) => {
            // Don't let Escape / overlay-click close mid-search.
            if (!next && isPending) return;
            setBibModalOpen(next);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{labels.bibModalTitle}</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                runBibSearch();
              }}
            >
              <p className="text-sm text-muted-foreground">{labels.bibModalDescription}</p>
              <Input
                autoFocus
                inputMode="numeric"
                value={bibValue}
                onChange={(e) => setBibValue(e.target.value)}
                placeholder={labels.bibPlaceholder}
                aria-label={labels.bibButton}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBibModalOpen(false)}
                  disabled={isPending}
                >
                  {labels.bibCancel}
                </Button>
                <Button type="submit" size="sm" disabled={isPending || !bibValue.trim()}>
                  {labels.bibSearch}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
