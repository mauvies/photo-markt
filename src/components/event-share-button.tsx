'use client';

import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shareUrl } from '@/lib/share-url';
import { cn } from '@/lib/utils';

type EventShareButtonProps = {
  /** Event name, used as the Web Share API title. */
  eventName: string;
  /** Public event URL (`/events/[shareCode-or-slug]`) — never the dashboard route. */
  eventUrl: string;
  tooltip: string;
  className?: string;
};

/** Icon-only share button for the event title header. */
export function EventShareButton({
  eventName,
  eventUrl,
  tooltip,
  className,
}: EventShareButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => shareUrl(eventName, eventUrl)}
          aria-label={tooltip}
          className={cn('size-10', className)}
        >
          <Share2 className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
