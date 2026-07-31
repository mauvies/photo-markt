'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface EventCoverFieldLabels {
  label: string;
  desc: string;
  infoAria: string;
  select: string;
  remove: string;
}

interface EventCoverFieldProps {
  /** Current preview URL (object-URL for a freshly picked file, or a signed
   *  URL for an already-saved cover). `null` shows the empty upload state. */
  previewUrl: string | null;
  /** Called with the picked File, or `null` when the cover is removed. */
  onCoverChange: (file: File | null) => void;
  labels: EventCoverFieldLabels;
  /** Disable the input/remove control while an async op is in flight. */
  busy?: boolean;
  /** Unique id for the file input (distinct per surface if both mount at once). */
  inputId?: string;
}

/**
 * Dedicated event cover/presentation image field (T-055), shared by the create
 * wizard (`events/new`) and the edit form (`events/[id]/edit`, T-166) so the two
 * never drift. Purely presentational: the owner wires `onCoverChange` to hold a
 * File (create, deferred upload) or persist immediately (edit).
 */
export function EventCoverField({
  previewUrl,
  onCoverChange,
  labels,
  busy = false,
  inputId = 'cover-image',
}: EventCoverFieldProps) {
  // Compact fixed height on every surface. A `fill` flag used to stretch the
  // box to match a neighbouring column — that existed only for the create
  // wizard's cover-beside-details layout, which T-210 replaced.
  const boxHeight = 'h-40 w-full';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={inputId}>{labels.label}</Label>
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={labels.infoAria}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-56">{labels.desc}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {previewUrl ? (
        <div className={cn('relative overflow-hidden rounded-lg border border-input', boxHeight)}>
          {/* biome-ignore lint/performance/noImgElement: preview can be a blob: object-URL that next/image can't optimize */}
          <img src={previewUrl} alt={labels.label} className="h-full w-full object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute right-2 top-2"
            disabled={busy}
            onClick={() => onCoverChange(null)}
          >
            {labels.remove}
          </Button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={cn(
            'flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40',
            boxHeight,
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {labels.select}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file) onCoverChange(file);
              // Allow re-selecting the same file after removing it.
              event.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}
