'use client';

import { ScanText } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { disableBibDetectionForEvent, enableBibDetectionForEvent } from './actions';

export interface BibDetectionToggleLabels {
  title: string;
  description: string;
  /** Shown when the event contains minors (toggle disabled). */
  minorsDisabled: string;
  enableFailed: string;
  enabled: string;
  disabled: string;
}

/**
 * Owner-only per-event opt-in for BIB number detection (T-032). Flipping it on
 * fires the backfill over existing photos; new uploads are detected
 * automatically. Disabled when the event contains minors, for parity with face
 * matching.
 */
export function BibDetectionToggle({
  eventId,
  initialEnabled,
  containsMinors,
  labels,
}: {
  eventId: string;
  initialEnabled: boolean;
  containsMinors: boolean;
  labels: BibDetectionToggleLabels;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    setEnabled(next); // optimistic
    startTransition(async () => {
      try {
        if (next) await enableBibDetectionForEvent(eventId);
        else await disableBibDetectionForEvent(eventId);
      } catch (error) {
        setEnabled(!next); // revert
        toast.error(error instanceof Error ? error.message : labels.enableFailed);
      }
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ScanText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="font-semibold text-foreground">{labels.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{labels.description}</p>
            {containsMinors ? (
              <p className="mt-2 text-xs text-muted-foreground">{labels.minorsDisabled}</p>
            ) : null}
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={containsMinors || isPending}
          onCheckedChange={handleChange}
          aria-label={labels.title}
        />
      </div>
      {!containsMinors ? (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {enabled ? labels.enabled : labels.disabled}
        </p>
      ) : null}
    </div>
  );
}
