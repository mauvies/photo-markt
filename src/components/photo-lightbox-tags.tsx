'use client';

import { X } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { untagPhotoForTalentAction } from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PhotoTag {
  tag_id: string;
  talent_user_id: string;
  talent_username: string;
  talent_display_name: string | null;
  tagged_at: string;
}

interface PhotoLightboxTagsProps {
  photoId: string;
  tags: PhotoTag[];
  onUntag?: () => void;
}

export function PhotoLightboxTags({ photoId, tags, onUntag }: PhotoLightboxTagsProps) {
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">Tagged:</span>
      {tags.map((tag) => (
        <TooltipProvider key={tag.tag_id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="group relative inline-flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-xs backdrop-blur-sm">
                <span className="max-w-[120px] truncate">
                  {tag.talent_display_name || tag.talent_username}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUntag(tag.talent_user_id);
                  }}
                  disabled={isUntagging}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors disabled:opacity-50"
                  aria-label={`Remove tag for ${tag.talent_display_name || tag.talent_username}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>@{tag.talent_username}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}
