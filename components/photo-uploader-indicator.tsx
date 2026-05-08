'use client';

import { Camera } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface PhotoUploaderInfo {
  /** Display name (guest name, profile display_name, or fallback). */
  name: string;
  /** Optional email. Currently only set for guest contributors. */
  email?: string | null;
  /** True when uploader was authenticated, false for guests. */
  isAuthenticated: boolean;
}

interface PhotoUploaderIndicatorProps {
  uploader: PhotoUploaderInfo;
  className?: string;
  isPopoverOpen?: boolean;
  onPopoverOpenChange?: (open: boolean) => void;
  tooltip?: string;
  /** Header shown above the name in the popover (e.g. "Uploaded by"). */
  popoverHeading?: string;
}

export function PhotoUploaderIndicator({
  uploader,
  className,
  isPopoverOpen = false,
  onPopoverOpenChange,
  tooltip,
  popoverHeading,
}: PhotoUploaderIndicatorProps) {
  return (
    <Popover onOpenChange={onPopoverOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'pointer-events-auto relative flex size-6 items-center justify-center rounded-full',
                'bg-gray-900/45 backdrop-blur-sm text-white shadow-sm',
                'transition-colors hover:bg-gray-900/80 border-0 p-0',
                isPopoverOpen && 'bg-gray-900/80',
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
              <Camera className="size-3" />
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
        <div className="space-y-1">
          {popoverHeading ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {popoverHeading}
            </p>
          ) : null}
          <p className="text-sm font-medium break-words">{uploader.name}</p>
          {uploader.email ? (
            <p className="text-xs text-muted-foreground break-all">{uploader.email}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
