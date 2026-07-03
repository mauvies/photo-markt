'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface DraftResumeDialogLabels {
  title: string;
  description: string;
  continueDraft: string;
  startFresh: string;
}

/**
 * Blocking prompt shown on the event wizard when a genuine in-progress draft is
 * detected (T-059). The user must choose explicitly: resume where they left off
 * or discard the draft and start a new event. Controlled `open` with no
 * `onOpenChange` keeps it from being dismissed by outside-click / Escape — the
 * only way out is one of the two buttons.
 */
export function DraftResumeDialog({
  open,
  onContinue,
  onStartFresh,
  labels,
}: {
  open: boolean;
  onContinue: () => void;
  onStartFresh: () => void;
  labels: DraftResumeDialogLabels;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Start-fresh is the secondary (discards work); continue is primary. */}
          <AlertDialogCancel onClick={onStartFresh}>{labels.startFresh}</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue}>{labels.continueDraft}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
