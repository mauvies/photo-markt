'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface LoadMoreResult<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
}

export interface UseLoadMorePhotosOptions<T extends { id: string }> {
  /** The server-rendered first batch. */
  initialItems: T[];
  /** Whether the server reported more photos beyond the first batch. */
  initialHasMore: boolean;
  /** The offset the next fetch should start at (usually `initialItems.length`). */
  initialOffset: number;
  /** Fetches the next batch — a Server Action bound to the event. */
  fetchMore: (offset: number) => Promise<LoadMoreResult<T>>;
  /** Called when a fetch throws. Defaults to `console.error`. */
  onError?: (error: unknown) => void;
}

export interface UseLoadMorePhotosResult<T> {
  /** All loaded items, flattened + deduped, in load order. */
  items: T[];
  /** The items grouped by the fetch that produced them (page 0 = initial
   * batch). Callers render each page as an independent layout segment so a
   * "Load more" append never re-flows already-rendered pages. */
  pages: T[][];
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => Promise<void>;
}

/**
 * Client-side accumulator for the paginated event gallery. Starts from the
 * server's first batch and appends each subsequent `fetchMore(offset)` result,
 * deduping by id. Re-seeds from `initialItems` whenever their id-signature
 * changes — e.g. after a `router.refresh()` following an optimistic delete or a
 * fresh upload — so the accumulated list can't drift from the server truth.
 */
export function useLoadMorePhotos<T extends { id: string }>({
  initialItems,
  initialHasMore,
  initialOffset,
  fetchMore,
  onError,
}: UseLoadMorePhotosOptions<T>): UseLoadMorePhotosResult<T> {
  // One entry per fetch (page 0 = the server's first batch). Kept as an array
  // of pages — not a flat list — so callers can lay out each page as its own
  // segment and prior pages never re-flow when a new one appends.
  const [pages, setPages] = useState<T[][]>([initialItems]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const offsetRef = useRef(initialOffset);

  const items = useMemo(() => pages.flat(), [pages]);

  // Re-seed when the server sends a new first batch (identity by id-signature).
  const signature = initialItems.map((i) => i.id).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed keyed on the id-signature, not the array identity
  useEffect(() => {
    setPages([initialItems]);
    setHasMore(initialHasMore);
    offsetRef.current = initialOffset;
  }, [signature, initialHasMore, initialOffset]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const result = await fetchMore(offsetRef.current);
      offsetRef.current = result.nextOffset;
      setPages((prev) => {
        const seen = new Set(prev.flat().map((p) => p.id));
        const fresh = result.items.filter((item) => !seen.has(item.id));
        return fresh.length > 0 ? [...prev, fresh] : prev;
      });
      setHasMore(result.hasMore);
    } catch (error) {
      (onError ?? console.error)(error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, fetchMore, onError]);

  return { items, pages, hasMore, isLoadingMore, loadMore };
}
