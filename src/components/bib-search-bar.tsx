'use client';

import { ScanText, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { searchPhotosByBibInEvent } from '@/app/[lang]/events/[shareCode]/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface BibSearchBarLabels {
  title: string;
  placeholder: string;
  button: string;
  clear: string;
  failed: string;
}

/**
 * Talent-facing "search this event by bib number" bar. On search it calls the
 * server action and hands the matched photo ids up via `onResults`; the gallery
 * viewer reads them from the bib-search context and filters the grid. `onResults`
 * is called with `null` when the search is cleared (back to the full grid).
 */
export function BibSearchBar({
  shareCode,
  labels,
  onResults,
  hasResults,
}: {
  shareCode: string;
  labels: BibSearchBarLabels;
  onResults: (photoIds: string[] | null) => void;
  hasResults: boolean;
}) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const runSearch = () => {
    const bib = value.trim();
    if (!bib) return;
    startTransition(async () => {
      try {
        const result = await searchPhotosByBibInEvent(shareCode, bib);
        onResults(result.photoIds);
      } catch {
        // Includes the rate-limit signal — a single generic message is fine here.
        toast.error(labels.failed);
      }
    });
  };

  const clear = () => {
    setValue('');
    onResults(null);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <ScanText className="h-4 w-4 text-muted-foreground" aria-hidden />
        {labels.title}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <Input
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={labels.placeholder}
          aria-label={labels.title}
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={isPending || !value.trim()}>
          {labels.button}
        </Button>
        {hasResults ? (
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            <X className="mr-1 h-4 w-4" />
            {labels.clear}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
