'use client';

import { MoreVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { useLocalizedPath } from '@/hooks/use-localized-path';

type EventCardActionsProps = {
  editHref: string;
  onDelete: () => Promise<void>;
  labels: {
    edit: string;
    delete: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    deleteCancel: string;
    ariaOpen: string;
    moreOptions: string;
  };
};

/**
 * The owner-only top-left action menu rendered on photographer event cards.
 * Lives here (not inside the shared `EventCard`) so the shared component stays
 * presentational and the explore-side cards don't pull in the dropdown UI.
 */
export function EventCardActions({ editHref, onDelete, labels }: EventCardActionsProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Don't render the tooltip on touch devices — tapping the trigger should
  // open the dropdown immediately, not flash a tooltip first.
  const isCoarse = useCoarsePointer();

  const handleDelete = async () => {
    await onDelete();
    router.refresh();
  };

  // Matches the activity/visibility overlay badges on the cover so all three
  // icons read as a consistent action-icon row.
  const triggerClass =
    'flex h-8 w-8 items-center justify-center rounded-full bg-gray-900/60 text-white backdrop-blur-sm shadow-sm transition-colors hover:bg-gray-900/80 focus-visible:outline-none disabled:opacity-50 sm:h-7 sm:w-7';

  const trigger = (
    <button
      type="button"
      disabled={isPending}
      aria-label={labels.ariaOpen}
      className={triggerClass}
    >
      <MoreVertical className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
    </button>
  );

  return (
    <>
      <DropdownMenu>
        {isCoarse ? (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>{labels.moreOptions}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              router.push(lp(editHref));
            }}
            disabled={isPending}
          >
            {labels.edit}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setDeleteDialogOpen(true);
            }}
            variant="destructive"
            disabled={isPending}
          >
            {labels.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={labels.deleteTitle}
        description={labels.deleteDescription}
        confirmText={labels.deleteConfirm}
        cancelText={labels.deleteCancel}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
