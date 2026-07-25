'use client';

import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteEventAction } from '@/app/[lang]/dashboard/photographer/events/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { Dictionary } from '@/lib/i18n/get-dictionary';

type EventsT = Dictionary['events'];

type EventActionsMenuProps = {
  eventId: string;
  t: EventsT;
};

export function EventActionsMenu({ eventId, t }: EventActionsMenuProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, startDeleting] = useTransition();

  const confirmDeleteEvent = useCallback(() => {
    startDeleting(async () => {
      try {
        await deleteEventAction(eventId);
        router.push(lp('/dashboard/photographer/events'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.failedDeleteEvent);
      }
    });
  }, [eventId, router, lp, t]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t.eventActionsMenuLabel}
            className="w-10 h-10"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={lp(`/dashboard/photographer/events/${eventId}/edit`)}>
              <Pencil className="mr-2 h-4 w-4" />
              {t.editEvent}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setDeleteDialogOpen(true);
            }}
            disabled={isDeleting}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isDeleting ? t.deletingLabel : t.deleteEvent}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t.deleteConfirmTitle}
        description={t.deleteConfirmDesc}
        confirmText={t.confirmButton}
        cancelText={t.cancelButton}
        onConfirm={confirmDeleteEvent}
      />
    </>
  );
}
