'use client';

import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { ContributeSection } from './contribute-section';

type CollaborativeT = Dictionary['collaborativeEvent'];

type ContributeDialogProps = {
  eventId: string;
  shareCode: string;
  isAuthenticated: boolean;
  requireApproval: boolean;
  t: CollaborativeT;
};

/**
 * Contribute affordance for collaborative events: a card with copy + a button,
 * and the upload modal it opens.
 *
 * The modal open state is plain local React state, so clicking the button
 * opens it instantly. The previous implementation toggled a `?contribute=1`
 * query param via `router.push`, which triggered a full server round-trip
 * (re-running auth, role and cart lookups) before the modal could appear —
 * that round-trip was the perceived "slow to open" delay.
 */
export function ContributeDialog({
  eventId,
  shareCode,
  isAuthenticated,
  requireApproval,
  t,
}: ContributeDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-input bg-card p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold md:text-lg">{t.contributeCardTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.contributeCardDesc}</p>
        </div>
        <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
          <ImagePlus className="mr-2 h-4 w-4" />
          {t.contributeCardButton}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.uploadHeading}</DialogTitle>
            <DialogDescription>
              {requireApproval ? t.uploadDescPending : t.uploadDesc}
            </DialogDescription>
          </DialogHeader>
          <ContributeSection
            eventId={eventId}
            shareCode={shareCode}
            isAuthenticated={isAuthenticated}
            requireApproval={requireApproval}
            t={t}
            embedded
            onSuccess={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
