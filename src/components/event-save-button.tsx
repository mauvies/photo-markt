'use client';

import { Heart, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSavedEventsLabels } from '@/components/saved-events-labels-provider';
import { Button } from '@/components/ui/button';
import { PhotoActionIcon } from '@/components/ui/photo-action-icon';
import { useSavedEvents } from '@/hooks/use-saved-events';
import { cn } from '@/lib/utils';

type EventSaveButtonProps = {
  eventId: string;
  /**
   * `overlay` — dark pill heart icon for event-card corners (default).
   * `button`  — labeled Save/Saved button for the event-detail header.
   */
  variant?: 'overlay' | 'button';
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

  if (variant === 'button') {
    return (
      <Button
        type="button"
        variant={saved ? 'secondary' : 'outline'}
        size="sm"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={saved}
        className={cn('gap-2', className)}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Heart className="size-4" fill={saved ? 'currentColor' : 'none'} />
        )}
        {tooltip}
      </Button>
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
