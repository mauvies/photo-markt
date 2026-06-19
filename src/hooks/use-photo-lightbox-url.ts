'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

type LightboxItem = { id: string };

/**
 * Syncs a photo lightbox with a URL query parameter so the browser back
 * button closes the viewer instead of navigating away, and so individual
 * photos are linkable/shareable.
 *
 * Implementation note: we use `window.history.pushState/replaceState`
 * (Next 14.1+) instead of `router.push/replace` — those latter trigger a
 * full RSC refetch of the current route segment, which made opening a
 * photo perceptibly slow and (worse) re-spawned the `items` prop with a
 * fresh reference on every URL update, which then triggered downstream
 * effects in the lightbox that auto-advanced photos. History API calls
 * integrate with `useSearchParams` for shallow updates without re-running
 * the server.
 *
 * Semantics:
 * - Opening a photo pushes a new history entry, so the browser back
 *   button pops back to the pre-open state.
 * - Switching photos inside the lightbox replaces the URL — one history
 *   entry per open, not per photo.
 * - Closing pops the push entry when we own it, or replaces the URL when
 *   the lightbox was opened from a deep link (no prior entry to pop).
 *
 * The `index` value is derived from the URL on every render, which means
 * back/forward navigation automatically updates the lightbox state.
 */
export function usePhotoLightboxUrl<T extends LightboxItem>(items: T[], paramName = 'photo') {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Tracks whether the current lightbox session pushed a history entry.
  // If the user landed on a URL that already contained `?photo=…`, we did
  // not push — so closing must use replaceState, not history.back().
  const pushedRef = useRef(false);

  const photoId = searchParams.get(paramName);

  const index = useMemo(
    () => (photoId ? items.findIndex((item) => item.id === photoId) : -1),
    [items, photoId],
  );

  const buildHref = useCallback(
    (id?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set(paramName, id);
      else params.delete(paramName);
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [searchParams, pathname, paramName],
  );

  const openAt = useCallback(
    (id: string) => {
      if (typeof window === 'undefined') return;
      window.history.pushState(null, '', buildHref(id));
      pushedRef.current = true;
    },
    [buildHref],
  );

  const switchTo = useCallback(
    (id: string) => {
      if (typeof window === 'undefined') return;
      if (id === photoId) return;
      window.history.replaceState(null, '', buildHref(id));
    },
    [buildHref, photoId],
  );

  const close = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (pushedRef.current) {
      window.history.back();
      pushedRef.current = false;
    } else {
      window.history.replaceState(null, '', buildHref());
    }
  }, [buildHref]);

  return { index, open: index >= 0, openAt, switchTo, close };
}
