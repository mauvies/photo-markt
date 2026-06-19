'use client';

import { useEffect, useRef } from 'react';
import { markEventSeen } from '@/app/[lang]/actions/saved-events';
import { useSavedEvents } from '@/hooks/use-saved-events';

/**
 * Records that the talent visited a saved event by stamping last_seen_at once
 * per page load. No-op (renders nothing, makes no call) unless the viewer is a
 * talent who has this event saved. Populates data for a future "new photos
 * since last visit" feature — nothing surfaces it yet.
 */
export function MarkEventSeen({ eventId }: { eventId: string }) {
  const { isTalent, isSaved } = useSavedEvents();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!isTalent || !isSaved(eventId)) return;
    firedRef.current = true;
    void markEventSeen(eventId).catch(() => {
      // Best-effort telemetry — never disrupt the page if it fails.
    });
  }, [isTalent, isSaved, eventId]);

  return null;
}
