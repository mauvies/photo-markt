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
  };
};

/**
 * The owner-only top-right action menu rendered on photographer event cards.
 * Lives here (not inside the shared `EventCard`) so the shared component stays
 * presentational and the explore-side cards don't pull in the dropdown UI.
 */
export function EventCardActions({ editHref, onDelete, labels }: EventCardActionsProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDelete = async () => {
    await onDelete();
    router.refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            aria-label={labels.ariaOpen}
            className="pointer-events-none flex size-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-all group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
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
