'use client';

import { CheckCircle2, Loader2, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { getSubscriptionStatusAction } from '../billing/actions';

interface SubscriptionConfirmingBannerProps {
  /** Translated strings, fed from the server component's dict (this subtree
   * has no TranslationsProvider). `activeBody` contains a `{planName}` token. */
  t: {
    confirmingTitle: string;
    confirmingBody: string;
    activeTitle: string;
    activeBody: string;
    slowBody: string;
    refresh: string;
    dismiss: string;
  };
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 10; // ~25s before showing the "taking longer" fallback.

/**
 * Shown on the overview after returning from Stripe checkout (`?checkout=success`).
 *
 * Activation is done exclusively by the Stripe webhook, which can land a few
 * seconds after the browser redirect. This banner never activates anything — it
 * only *polls* the current plan (`getSubscriptionStatusAction`, a service-role
 * read) and reflects the transition: "confirming…" → success once the webhook
 * has applied the paid plan, or a "taking longer" fallback after a bounded
 * number of attempts. On success it refreshes the route so the rest of the
 * dashboard picks up the new plan.
 */
export function SubscriptionConfirmingBanner({ t }: SubscriptionConfirmingBannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<'confirming' | 'active' | 'slow'>('confirming');
  const [planName, setPlanName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Drop `?checkout=success` from the URL so a later hard refresh / Back doesn't
  // re-mount this banner and restart the confirming spinner on an
  // already-subscribed dashboard. Uses history.replaceState (not
  // router.replace) so the React tree — and the polling below — stays mounted.
  useEffect(() => {
    window.history.replaceState(null, '', pathname);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const status = await getSubscriptionStatusAction();
        if (cancelled) return;
        if (status.active) {
          setPlanName(status.planId);
          setPhase('active');
          router.refresh();
          return;
        }
      } catch {
        // Transient read failure — keep polling until the attempt budget runs
        // out, then fall back to the "taking longer" message.
      }
      if (cancelled) return;
      if (attempts >= MAX_POLLS) {
        setPhase('slow');
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    let timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  const onRefresh = useCallback(() => router.refresh(), [router]);

  if (dismissed) return null;

  const isActive = phase === 'active';
  const title = isActive ? t.activeTitle : t.confirmingTitle;
  const body = isActive
    ? t.activeBody.replace('{planName}', formatPlanName(planName))
    : phase === 'slow'
      ? t.slowBody
      : t.confirmingBody;

  return (
    // <output> carries an implicit role="status" live region — announces the
    // confirming → active transition to assistive tech without a manual role.
    <output
      className={`flex w-full items-start gap-3 rounded-lg border p-4 ${
        isActive ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-muted/40'
      }`}
      aria-live="polite"
    >
      <div className="mt-0.5 shrink-0">
        {isActive ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        {phase === 'slow' && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 text-sm font-medium text-primary hover:underline"
          >
            {t.refresh}
          </button>
        )}
      </div>
      {isActive && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t.dismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </output>
  );
}

/** Title-case a plan id for display (starter → Starter). */
function formatPlanName(planId: string | null): string {
  if (!planId) return '';
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}
