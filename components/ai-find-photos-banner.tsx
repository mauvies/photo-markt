'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AIFindPhotosBannerLabels {
  titleReady: string;
  titleIndexing: string;
  descriptionReady: string;
  descriptionIndexing: string;
  cta: string;
}

interface AIFindPhotosBannerProps {
  /**
   * Surface state — `'ready'` shows the "Find yourself" copy; `'indexing'`
   * shows the "Processing..." copy with the same CTA. The parent component
   * is responsible for hiding the banner entirely on `'idle'` / `'failed'`
   * / `0 indexed photos` / AI disabled.
   */
  state: 'ready' | 'indexing';
  labels: AIFindPhotosBannerLabels;
  onOpenSearch: () => void;
}

/**
 * Alert-style card that sits above the photo gallery on event pages and
 * invites the talent to find themselves via AI face search. Visual matches
 * the collaborative "Have photos of this event?" card — `bg-card` with a
 * plain input border, no left avatar/icon, copy on the left, primary
 * button (with sparkles to mark the AI affordance) on the right. Stacks
 * on mobile. Not dismissible, not sticky.
 */
export function AIFindPhotosBanner({ state, labels, onOpenSearch }: AIFindPhotosBannerProps) {
  const isIndexing = state === 'indexing';
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-input bg-card p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold md:text-lg">
          {isIndexing ? labels.titleIndexing : labels.titleReady}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isIndexing ? labels.descriptionIndexing : labels.descriptionReady}
        </p>
      </div>
      <Button type="button" onClick={onOpenSearch} className="shrink-0">
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        {labels.cta}
      </Button>
    </div>
  );
}
