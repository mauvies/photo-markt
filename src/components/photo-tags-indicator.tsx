'use client';

import { Trash2, UserPlus, Users } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { untagPhotoForTalentAction } from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PhotoTag {
  tag_id: string;
  talent_user_id: string;
  talent_username: string;
  talent_display_name: string | null;
  tagged_at: string;
}

interface PhotoTagsIndicatorProps {
  tags: PhotoTag[];
  photoId: string;
  className?: string;
  onUntag?: () => void;
  onTagPhoto?: (photoId: string) => void;
  isDropdownOpen?: boolean;
  onDropdownOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function PhotoTagsIndicator({
  tags,
  photoId,
  className,
  onUntag,
  onTagPhoto,
  isDropdownOpen: _isDropdownOpen = false,
  onDropdownOpenChange,
  tooltip,
}: PhotoTagsIndicatorProps) {
  const [isUntagging, startUntagging] = useTransition();

  if (tags.length === 0) {
    return null;
  }

  const handleUntag = (talentUserId: string) => {
    startUntagging(async () => {
      try {
        await untagPhotoForTalentAction(photoId, talentUserId);
        toast.success('Tag removed');
        onUntag?.();
      } catch (error) {
        console.error('Error untagging photo:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
      }
    });
  };

  return (
    <Popover onOpenChange={onDropdownOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'pointer-events-auto relative flex size-6 items-center justify-center rounded-full',
                'bg-gray-900/45 backdrop-blur-sm text-white shadow-sm',
                'transition-colors hover:bg-gray-900/80 border-0 p-0',
                _isDropdownOpen && 'bg-gray-900/80',
                className,
              )}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Users className="size-3" fill="currentColor" />
              {tags.length > 1 && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                  {tags.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {tooltip && (
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        className="w-64 p-3"
        side="top"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5">
          {tags.map((tag) => (
            <div
              key={tag.tag_id}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">@{tag.talent_username}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUntag(tag.talent_user_id);
                }}
                disabled={isUntagging}
                className="ml-2 rounded p-1 hover:text-destructive disabled:opacity-50"
                aria-label={`Remove tag for ${tag.talent_username}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {onTagPhoto && (
            <div className="border-t pt-1.5 mt-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagPhoto(photoId);
                  onDropdownOpenChange?.(false);
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Tag new people
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
