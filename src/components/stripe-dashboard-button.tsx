'use client';

import { ExternalLink } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  createStripeDashboardLinkAction,
  type StripeDashboardError,
} from '@/app/[lang]/actions/stripe-dashboard';
import { Button } from '@/components/ui/button';
import type { ButtonSize, ButtonVariant } from '@/components/ui/button-variants';

interface StripeDashboardButtonProps {
  /** Button copy, e.g. "Open my Stripe dashboard". */
  label: string;
  /** Shown when the account exists but has not finished onboarding. */
  errorNotReady: string;
  /** Shown when Stripe could not be reached. */
  errorUnavailable: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * Sends the photographer into their own Stripe Express dashboard (T-244).
 *
 * Rendered only where the connected account is already known to be `active` — the
 * action re-checks that server-side anyway, since a button is not a permission.
 *
 * ⚠️ **The tab is opened synchronously inside the click handler**, before the
 * `await`. Opening it after the action resolves loses the user-gesture context and
 * every mainstream browser blocks it as a popup — the click would appear to do
 * nothing at all. So a blank tab is claimed up front and either navigated or
 * closed once the URL comes back.
 */
export function StripeDashboardButton({
  label,
  errorNotReady,
  errorUnavailable,
  variant = 'outline',
  size = 'sm',
  className,
}: StripeDashboardButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<StripeDashboardError | null>(null);

  function handleClick() {
    setError(null);
    // Claimed here, inside the gesture. See the note above.
    const tab = window.open('', '_blank', 'noopener,noreferrer');

    startTransition(async () => {
      const result = await createStripeDashboardLinkAction();

      if (result.ok) {
        if (tab) tab.location.href = result.url;
        // Popup blocked despite the gesture (some hardened setups): fall back to
        // this tab rather than swallowing the click.
        else window.location.href = result.url;
        return;
      }

      tab?.close();
      setError(result.error);
    });
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={isPending}
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      {error && error !== 'not_connected' && (
        <p className="mt-2 text-sm text-destructive">
          {error === 'not_ready' ? errorNotReady : errorUnavailable}
        </p>
      )}
    </div>
  );
}
