import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

/**
 * Shared "your payout account isn't ready" strip (T-248).
 *
 * `blocked` (red) is used ONLY for `money_held` — earnings that already exist
 * and are stuck in the ledger. `info` (amber) covers the forecasts: priced
 * events whose sales will be held, and the plain unfinished-setup nudge.
 * Dressing a forecast in red teaches the photographer to ignore red.
 *
 * ⚠️ No checkout refuses anything over payout state (T-248) — the sale happens
 * and the money waits. One component so the two severities can't drift apart
 * visually between the dashboard and an event page.
 */
export function PayoutAccountAlert({
  severity,
  message,
  ctaHref,
  ctaLabel,
}: {
  severity: 'blocked' | 'info';
  message: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  const blocked = severity === 'blocked';
  return (
    <div
      className={
        blocked
          ? 'flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center dark:border-red-900 dark:bg-red-950'
          : 'flex flex-col gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 sm:flex-row sm:items-center dark:border-yellow-800 dark:bg-yellow-950'
      }
    >
      <div className="flex flex-1 items-start gap-3 sm:items-center">
        <AlertTriangle
          className={
            blocked
              ? 'mt-0.5 h-5 w-5 shrink-0 text-red-600 sm:mt-0 dark:text-red-400'
              : 'mt-0.5 h-5 w-5 shrink-0 text-yellow-600 sm:mt-0 dark:text-yellow-400'
          }
        />
        <div
          className={
            blocked
              ? 'text-sm text-red-800 dark:text-red-200'
              : 'text-sm text-yellow-800 dark:text-yellow-200'
          }
        >
          {message}
        </div>
      </div>
      <Link
        href={ctaHref}
        className={
          blocked
            ? 'shrink-0 self-start pl-8 text-sm font-medium text-red-800 underline sm:self-center sm:pl-0 dark:text-red-200'
            : 'shrink-0 self-start pl-8 text-sm font-medium text-yellow-800 underline sm:self-center sm:pl-0 dark:text-yellow-200'
        }
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
