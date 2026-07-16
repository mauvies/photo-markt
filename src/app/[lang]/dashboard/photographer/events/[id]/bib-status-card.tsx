'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { BibDetectionEventStatus } from '@/database/queries/bib-numbers';
import { displayedBibStatus, shouldPollBibStatus } from '@/lib/bib-detection-status';
import { getEventBibDetectionProgressAction } from './actions';

/**
 * Poll cadence for the bib-detection progress. Matches `AiStatusCard`'s 5s —
 * fast enough to feel live, slow enough to keep the server-action QPS
 * negligible.
 */
const POLL_INTERVAL_MS = 5000;
/** How long the "All photos processed" flash lingers after detecting → ready. */
const SUCCESS_FLASH_MS = 6000;
/** Surface a single error indicator after this many consecutive failed polls. */
const POLL_ERROR_THRESHOLD = 3;

interface BibStatusCardProps {
  eventId: string;
  status: BibDetectionEventStatus;
  totalApplicable: number;
  processed: number;
  pending: number;
  failed: number;
  withBibs: number;
  labels: {
    cardTitle: string;
    statusIdle: string;
    statusDetecting: string;
    statusReady: string;
    statusFailed: string;
    /** Template — `{count}` / `{total}` are replaced. */
    processedCount: string;
    /** Template — `{count}` is replaced with the photos-with-bibs count. */
    withBibs: string;
    pollUpdating: string;
    pollError: string;
    detectionComplete: string;
    /** Template — `{count}` is replaced with the failed photo count. */
    failedPhotosWarning: string;
  };
}

interface BibProgressState {
  status: BibDetectionEventStatus;
  processed: number;
  totalApplicable: number;
  failed: number;
  pending: number;
  withBibs: number;
}

/**
 * Owner-only status card for race-bib detection — the read-only counterpart of
 * `AiStatusCard`. Surfaces idle / detecting / ready plus "X of Y processed"
 * progress, polling while the `detectPhotoBibs` worker is still in flight. It
 * only reads the state the worker persists, so there's no re-run control (and
 * no new AWS cost). (T-139)
 */
export function BibStatusCard({
  eventId,
  status,
  totalApplicable,
  processed,
  pending,
  failed,
  withBibs,
  labels,
}: BibStatusCardProps) {
  // Server-rendered values seed the polling state; polls update it in place so
  // the counters stay accurate without a page refresh.
  const [state, setState] = useState<BibProgressState>({
    status,
    processed,
    totalApplicable,
    failed,
    pending,
    withBibs,
  });
  const [isFetching, setIsFetching] = useState(false);
  const [hasPollError, setHasPollError] = useState(false);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  const consecutiveErrors = useRef(0);
  // Tracks the *displayed* status so the success flash fires on the transition
  // the user actually sees (ready-while-pending is shown as detecting).
  const previousDisplayedStatus = useRef<BibDetectionEventStatus>(
    displayedBibStatus({ status, pending }),
  );

  useEffect(() => {
    // Re-seed whenever the parent re-renders with fresh server props (e.g. a
    // router.refresh() or navigating between events) so counters never carry
    // stale values from a different event.
    setState({ status, processed, totalApplicable, failed, pending, withBibs });
    previousDisplayedStatus.current = displayedBibStatus({ status, pending });
    consecutiveErrors.current = 0;
    setHasPollError(false);
    setShowSuccessFlash(false);
  }, [status, processed, totalApplicable, failed, pending, withBibs]);

  useEffect(() => {
    if (!shouldPollBibStatus(state)) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      setIsFetching(true);
      try {
        const next = await getEventBibDetectionProgressAction(eventId);
        if (cancelled) return;
        consecutiveErrors.current = 0;
        setHasPollError(false);

        const previous = previousDisplayedStatus.current;
        const nextDisplayed = displayedBibStatus({
          status: next.status,
          pending: next.pendingCount,
        });
        previousDisplayedStatus.current = nextDisplayed;
        if (previous === 'detecting' && nextDisplayed === 'ready') {
          setShowSuccessFlash(true);
        }

        setState({
          status: next.status,
          processed: next.processedCount,
          totalApplicable: next.totalCount,
          failed: next.failedCount,
          pending: next.pendingCount,
          withBibs: next.withBibsCount,
        });
      } catch {
        if (cancelled) return;
        consecutiveErrors.current += 1;
        if (consecutiveErrors.current >= POLL_ERROR_THRESHOLD) {
          setHasPollError(true);
        }
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    };

    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    // Don't kick the first poll synchronously — the server already rendered
    // fresh values into props; wait one interval before refreshing.
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // `state` purposely isn't a dep beyond the eligibility predicate — `tick`
    // reads the latest via setState closures.
  }, [eventId, state]);

  useEffect(() => {
    if (!showSuccessFlash) return;
    const timeoutId = window.setTimeout(() => setShowSuccessFlash(false), SUCCESS_FLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [showSuccessFlash]);

  const displayed = displayedBibStatus(state);

  const statusLabel =
    displayed === 'idle'
      ? labels.statusIdle
      : displayed === 'detecting'
        ? labels.statusDetecting
        : displayed === 'ready'
          ? labels.statusReady
          : labels.statusFailed;

  return (
    <section className="rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">{labels.cardTitle}</h2>
          <Badge variant={displayed === 'failed' ? 'destructive' : 'secondary'}>
            {statusLabel}
          </Badge>
          {isFetching ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              {labels.pollUpdating}
            </span>
          ) : null}
        </div>
      </header>
      <p className="mt-2 text-sm text-muted-foreground">
        {labels.processedCount
          .replace('{count}', String(state.processed))
          .replace('{total}', String(state.totalApplicable))}
      </p>
      {state.withBibs > 0 ? (
        <p className="text-xs text-muted-foreground">
          {labels.withBibs.replace('{count}', String(state.withBibs))}
        </p>
      ) : null}
      {state.failed > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {labels.failedPhotosWarning.replace('{count}', String(state.failed))}
          </span>
        </div>
      ) : null}
      {showSuccessFlash ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {labels.detectionComplete}
        </p>
      ) : null}
      {hasPollError ? (
        <p className="mt-2 text-xs text-destructive" aria-live="polite">
          {labels.pollError}
        </p>
      ) : null}
    </section>
  );
}
