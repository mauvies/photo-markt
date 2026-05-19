'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface LimitReachedToastProps {
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * Fires a one-shot error toast on mount. Used when the new-event wizard
 * redirects an at-limit user back to the events list with `?limit=events`.
 * `useRef` guards against StrictMode's double-mount in dev.
 */
export function LimitReachedToast({ message, ctaLabel, ctaHref }: LimitReachedToastProps) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast.error(message, {
      action: {
        label: ctaLabel,
        onClick: () => router.push(ctaHref),
      },
    });
  }, [message, ctaLabel, ctaHref, router]);

  return null;
}
