'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { getSavedEventIdsAction, saveEvent, unsaveEvent } from '@/app/[lang]/actions/saved-events';
import { useSavedEventsLabels } from '@/components/saved-events-labels-provider';
import { useAuthUser } from '@/hooks/use-auth-user';

const SAVED_EVENTS_KEY = ['saved-events'] as const;

type SavedEventsData = { isTalent: boolean; savedEventIds: string[] };

/**
 * Client source of truth for "which events has this talent saved". Backed by a
 * single shared React Query entry (`['saved-events']`) so every save button on
 * the page reads one deduped fetch. Guests and photographers resolve to
 * `isTalent: false` and render nothing. The query is gated on an authenticated
 * user so guests never pay the round-trip, keeping public pages cheap.
 *
 * `toggle` optimistically flips the cached set, then calls the matching server
 * action; on failure it reverts and surfaces a toast.
 */
export function useSavedEvents() {
  const { user } = useAuthUser();
  const queryClient = useQueryClient();
  const labels = useSavedEventsLabels();

  const { data } = useQuery<SavedEventsData>({
    queryKey: SAVED_EVENTS_KEY,
    queryFn: getSavedEventIdsAction,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const isTalent = data?.isTalent ?? false;
  const savedSet = useMemo(() => new Set(data?.savedEventIds ?? []), [data]);

  const setSaved = useCallback(
    (eventId: string, saved: boolean) => {
      queryClient.setQueryData<SavedEventsData>(SAVED_EVENTS_KEY, (prev) => {
        const base = prev ?? { isTalent: true, savedEventIds: [] };
        const ids = new Set(base.savedEventIds);
        if (saved) ids.add(eventId);
        else ids.delete(eventId);
        return { ...base, savedEventIds: [...ids] };
      });
    },
    [queryClient],
  );

  const toggle = useCallback(
    async (eventId: string): Promise<{ ok: boolean; saved: boolean }> => {
      const wasSaved = savedSet.has(eventId);
      setSaved(eventId, !wasSaved); // optimistic
      try {
        if (wasSaved) {
          await unsaveEvent(eventId);
          toast.success(labels.removedToast);
        } else {
          await saveEvent(eventId);
          toast.success(labels.savedToast);
        }
        return { ok: true, saved: !wasSaved };
      } catch (err) {
        setSaved(eventId, wasSaved); // revert
        const fallback = wasSaved ? labels.failedRemove : labels.failedSave;
        toast.error(err instanceof Error ? err.message : fallback);
        return { ok: false, saved: wasSaved };
      }
    },
    [savedSet, setSaved, labels],
  );

  return {
    isTalent,
    isSaved: useCallback((eventId: string) => savedSet.has(eventId), [savedSet]),
    toggle,
  };
}
