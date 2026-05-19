'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface RejectedToastProps {
  /** Number of photos currently visible to the owner — non-rejected rows. */
  visibleCount: number;
  /** Translated message; template `{n}` replaced with the rejected count. */
  label: string;
}

/**
 * Reads `?uploaded=N` from the URL, compares against the server-rendered
 * `visibleCount`, and fires a single toast when the worker has rejected
 * one or more photos (visibleCount < uploaded).
 *
 * After firing — and even if the toast doesn't fire because counts match —
 * the query param is stripped via `router.replace` so a refresh doesn't
 * re-fire the toast. The toast won't fire when `uploaded` is absent or
 * non-numeric, which is the correct behavior when the user arrives via
 * any path other than a fresh upload.
 */
export function RejectedToast({ visibleCount, label }: RejectedToastProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const raw = searchParams.get('uploaded');
    if (raw === null) return;
    fired.current = true;

    const uploaded = Number.parseInt(raw, 10);
    if (Number.isFinite(uploaded) && uploaded > visibleCount) {
      const rejected = uploaded - visibleCount;
      toast.error(label.replace('{n}', String(rejected)));
    }

    // Strip the param so a refresh doesn't re-trigger the toast.
    const next = new URLSearchParams(searchParams.toString());
    next.delete('uploaded');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [label, pathname, router, searchParams, visibleCount]);

  return null;
}
