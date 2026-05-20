'use client';

import { Download, MoreVertical, Share2, Trash2, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { photoActionIconClass } from '@/components/ui/photo-action-icon';
import { cn } from '@/lib/utils';

export interface PhotoMoreMenuLabels {
  trigger: string;
  delete: string;
  tagPeople: string;
  share: string;
  download: string;
}

interface PhotoMoreMenuProps {
  photoId: string;
  labels: PhotoMoreMenuLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (photoId: string) => void;
  onTagPeople: (photoId: string) => void;
  onShare: (photoId: string) => void;
  onDownload: (photoId: string) => void;
}

/**
 * Three-dot "more options" menu for a photo tile — the trigger matches the
 * PhotoActionIcon pattern (dark pill, white icon). Used on collaborative
 * events in the photographer dashboard. The trigger stops event propagation
 * so opening the menu never toggles selection or the lightbox.
 */
export function PhotoMoreMenu({
  photoId,
  labels,
  open,
  onOpenChange,
  onDelete,
  onTagPeople,
  onShare,
  onDownload,
}: PhotoMoreMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        type="button"
        aria-label={labels.trigger}
        className={cn(photoActionIconClass, open && 'bg-gray-900/80')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MoreVertical className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem className="cursor-pointer" onSelect={() => onDelete(photoId)}>
          <Trash2 className="mr-2 h-4 w-4" />
          {labels.delete}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onSelect={() => onTagPeople(photoId)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {labels.tagPeople}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onSelect={() => onShare(photoId)}>
          <Share2 className="mr-2 h-4 w-4" />
          {labels.share}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onSelect={() => onDownload(photoId)}>
          <Download className="mr-2 h-4 w-4" />
          {labels.download}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
