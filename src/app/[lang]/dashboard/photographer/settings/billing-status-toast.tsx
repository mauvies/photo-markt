'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface BillingStatusToastProps {
  /** Translated messages, fed from the server component's dict (this subtree
   * has no TranslationsProvider). Keyed by the `?status=` code. */
  messages: {
    cancelled: string;
    updated: string;
    checkout_failed: string;
    yearly_unavailable: string;
  };
}

/**
 * Surfaces the outcome carried on `?status=` after the billing resume route
 * (Stripe cancel, subscription updated in place, or a domain error) redirects
 * here. Fires a single toast and scrubs the query param so a refresh doesn't
 * re-toast. Purely presentational — no billing side effects.
 */
export function BillingStatusToast({ messages }: BillingStatusToastProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    const status = searchParams.get('status');
    if (!status || firedFor.current === status) return;
    firedFor.current = status;

    switch (status) {
      case 'cancelled':
        toast.info(messages.cancelled);
        break;
      case 'updated':
        toast.success(messages.updated);
        break;
      case 'yearly_unavailable':
        toast.error(messages.yearly_unavailable);
        break;
      case 'checkout_failed':
        toast.error(messages.checkout_failed);
        break;
      default:
        // Unknown status — nothing to show, but still scrub it below.
        break;
    }

    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname, messages]);

  return null;
}
