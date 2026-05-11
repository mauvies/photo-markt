'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

type LightboxItem = { id: string };

/**
 * Syncs a photo lightbox with a URL query parameter so the browser back
 * button closes the viewer instead of navigating away, and so individual
 * photos are linkable/shareable.
 *
 * Semantics:
 * - Opening a photo pushes a new history entry (`router.push`), so the
 *   browser back button pops back to the pre-open state.
 * - Switching photos inside the lightbox replaces the URL (`router.replace`)
 *   so we don't bloat history with one entry per photo.
 * - Closing pops the push entry via `router.back()` when we own it, or
 *   replaces the URL when the lightbox was opened from a deep link (no
 *   prior entry to pop).
 *
 * The `index` value is derived from the URL on every render, which means
 * back/forward navigation automatically updates the lightbox state.
 */
export function usePhotoLightboxUrl<T extends LightboxItem>(items: T[], paramName = 'photo') {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Tracks whether the current lightbox session pushed a history entry.
  // If the user landed on a URL that already contained `?photo=…`, we did
  // not push — so closing must use replace, not back.
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
      router.push(buildHref(id), { scroll: false });
      pushedRef.current = true;
    },
    [router, buildHref],
  );

  const switchTo = useCallback(
    (id: string) => {
      if (id === photoId) return;
      router.replace(buildHref(id), { scroll: false });
    },
    [router, buildHref, photoId],
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      router.back();
      pushedRef.current = false;
    } else {
      router.replace(buildHref(), { scroll: false });
    }
  }, [router, buildHref]);

  return { index, open: index >= 0, openAt, switchTo, close };
}
