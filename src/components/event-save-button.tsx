'use client';

import { Heart, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSavedEventsLabels } from '@/components/saved-events-labels-provider';
import { Button } from '@/components/ui/button';
import { PhotoActionIcon } from '@/components/ui/photo-action-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSavedEvents } from '@/hooks/use-saved-events';
import { cn } from '@/lib/utils';

type EventSaveButtonProps = {
  eventId: string;
  /**
   * `overlay` — dark pill heart icon for event-card corners (default).
   * `icon`    — plain ghost icon button with tooltip, for the event title header.
   */
  variant?: 'overlay' | 'icon';
  /** Fired after a successful toggle with the resulting saved state. */
  onToggled?: (saved: boolean) => void;
  className?: string;
};

/**
 * Save/unsave (bookmark) toggle for an event. Renders nothing for guests and
 * photographers — only authenticated talents see it. State + optimistic toggle
 * come from the shared `useSavedEvents` hook, so every instance on the page
 * stays in sync.
 */
export function EventSaveButton({
  eventId,
  variant = 'overlay',
  onToggled,
  className,
}: EventSaveButtonProps) {
  const { isTalent, isSaved, toggle } = useSavedEvents();
  const labels = useSavedEventsLabels();
  const [pending, setPending] = useState(false);

  if (!isTalent) return null;

  const saved = isSaved(eventId);
  const tooltip = saved ? labels.saved : labels.save;

  const onToggle = async () => {
    setPending(true);
    try {
      const result = await toggle(eventId);
      if (result.ok) onToggled?.(result.saved);
    } finally {
      setPending(false);
    }
  };

  if (variant === 'icon') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggle}
            disabled={pending}
            aria-pressed={saved}
            aria-label={tooltip}
            className={cn('size-10', className)}
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Heart className="size-5" fill={saved ? 'currentColor' : 'none'} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <PhotoActionIcon
      icon="save"
      active={saved}
      loading={pending}
      onClick={onToggle}
      tooltip={tooltip}
      className={className}
    />
  );
}
