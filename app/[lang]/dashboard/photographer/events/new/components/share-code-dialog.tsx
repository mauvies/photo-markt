'use client';

import { EventShareCode } from '@/components/event-share-code';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';

type NewEventT = Dictionary['newEvent'];

type ShareCodeDialogProps = {
  /**
   * Controls visibility. Parent must flip this to `false` BEFORE navigating
   * away — otherwise the dialog can rip out mid-render and leave Radix
   * body styles / overlay nodes stranded on the destination route.
   */
  open: boolean;
  shareCode: string;
  eventName: string;
  onOpenChange: (open: boolean) => void;
  onGoToEvent: () => void;
};

export function ShareCodeDialog({
  open,
  shareCode,
  eventName,
  onOpenChange,
  onGoToEvent,
}: ShareCodeDialogProps) {
  const { t } = useTranslations<NewEventT>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shareTitle')}</DialogTitle>
          <DialogDescription>{t('shareDesc')}</DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <EventShareCode shareCode={shareCode} eventName={eventName} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button type="button" onClick={onGoToEvent} className="rounded-md">
            {t('shareGoToEvent')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
