'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AiMatchingStatus } from '@/database/queries/rekognition';
import { getEventIndexingProgress, reindexEvent } from './actions';

/**
 * Cadence for the indexing-progress poll. 5 seconds is a good balance:
 * fast enough that the user feels "live", slow enough to keep the
 * server-action / Supabase QPS negligible for normal use.
 */
const POLL_INTERVAL_MS = 5000;
/**
 * How long the "All photos indexed" flash stays visible after a transition
 * from `indexing → ready`. Auto-dismisses so the card returns to its
 * normal idle state without user intervention.
 */
const SUCCESS_FLASH_MS = 6000;
/**
 * After this many consecutive failed polls in a row, surface a single
 * error indicator. Individual failures are swallowed so we don't spam
 * the toast layer.
 */
const POLL_ERROR_THRESHOLD = 3;

interface AiStatusCardProps {
  eventId: string;
  status: AiMatchingStatus;
  totalApplicable: number;
  indexed: number;
  pending: number;
  failed: number;
  lastIndexedAt: string | null;
  labels: {
    title: string;
    statusIdle: string;
    statusIndexing: string;
    statusReady: string;
    statusFailed: string;
    indexedCount: string;
    lastIndexed: string;
    reindex: string;
    reindexConfirmTitle: string;
    reindexConfirmBody: string;
    cancel: string;
    confirm: string;
    reindexFailed: string;
    pollUpdating: string;
    pollError: string;
    indexingComplete: string;
    /** Template — `{count}` is replaced with the failed photo count. */
    failedPhotosWarning: string;
    failedPhotosRetry: string;
  };
}

interface IndexingState {
  status: AiMatchingStatus;
  indexed: number;
  totalApplicable: number;
  failed: number;
  pending: number;
  lastIndexedAt: string | null;
}

/** True while the worker is making progress and the UI should keep polling. */
function shouldPoll(state: IndexingState): boolean {
  if (state.status === 'indexing') return true;
  if (state.status === 'idle' && state.pending > 0) return true;
  return false;
}

export function AiStatusCard({
  eventId,
  status,
  totalApplicable,
  indexed,
  pending,
  failed,
  lastIndexedAt,
  labels,
}: AiStatusCardProps) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Server-rendered values seed the polling state. Subsequent polls update
  // it in place so the visible counters stay accurate without a refresh.
  const [state, setState] = useState<IndexingState>({
    status,
    indexed,
    totalApplicable,
    failed,
    pending,
    lastIndexedAt,
  });
  const [isFetching, setIsFetching] = useState(false);
  const [hasPollError, setHasPollError] = useState(false);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  // Refs the polling effect reads without re-subscribing on every tick.
  const consecutiveErrors = useRef(0);
  const previousStatus = useRef<AiMatchingStatus>(status);

  useEffect(() => {
    // Re-seed state whenever the parent re-renders this card with fresh
    // server-rendered props (e.g. after a `router.refresh()` or navigating
    // between events). Without this the counters would carry stale values
    // from a different event.
    setState({ status, indexed, totalApplicable, failed, pending, lastIndexedAt });
    previousStatus.current = status;
    consecutiveErrors.current = 0;
    setHasPollError(false);
    setShowSuccessFlash(false);
  }, [status, indexed, totalApplicable, failed, pending, lastIndexedAt]);

  useEffect(() => {
    if (!shouldPoll(state)) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      setIsFetching(true);
      try {
        const next = await getEventIndexingProgress(eventId);
        if (cancelled) return;
        consecutiveErrors.current = 0;
        setHasPollError(false);

        const previous = previousStatus.current;
        previousStatus.current = next.status;
        if (previous === 'indexing' && next.status === 'ready') {
          // Flash a success banner; auto-dismiss after a few seconds.
          setShowSuccessFlash(true);
        }

        setState({
          status: next.status,
          indexed: next.indexedCount,
          totalApplicable: next.totalCount,
          failed: next.failedCount,
          pending: next.pendingCount,
          lastIndexedAt: next.lastIndexedAt,
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
    // fresh values into props, so wait one interval before refreshing.
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // Re-subscribe whenever the polling-eligibility predicate changes or
    // we navigate to a different event. `state` purposely isn't in the
    // dep list — `tick` reads the latest via setState closures.
  }, [eventId, state]);

  useEffect(() => {
    if (!showSuccessFlash) return;
    const timeoutId = window.setTimeout(() => setShowSuccessFlash(false), SUCCESS_FLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [showSuccessFlash]);

  const statusLabel =
    state.status === 'idle'
      ? labels.statusIdle
      : state.status === 'indexing'
        ? labels.statusIndexing
        : state.status === 'ready'
          ? labels.statusReady
          : labels.statusFailed;

  const reindexEnabled = state.status === 'ready' || state.status === 'failed';

  const triggerReindex = () => {
    setDialogOpen(false);
    startTransition(async () => {
      try {
        await reindexEvent(eventId);
        // Reset the previous-status ref so the next ready transition flashes.
        previousStatus.current = 'indexing';
      } catch (err) {
        toast.error(err instanceof Error ? err.message : labels.reindexFailed);
      }
    });
  };

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">{labels.title}</h2>
          <Badge variant={state.status === 'failed' ? 'destructive' : 'secondary'}>
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
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!reindexEnabled || isPending}
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {labels.reindex}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.reindexConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{labels.reindexConfirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={triggerReindex}>{labels.confirm}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>
      <p className="mt-2 text-sm text-muted-foreground">
        {labels.indexedCount
          .replace('{count}', String(state.indexed))
          .replace('{total}', String(state.totalApplicable))}
      </p>
      {state.lastIndexedAt && (
        <p className="text-xs text-muted-foreground">
          {labels.lastIndexed.replace('{at}', new Date(state.lastIndexedAt).toLocaleString())}
        </p>
      )}
      {state.failed > 0 ? (
        // Surface failed photos as an actionable warning chip. The "Retry"
        // anchor opens the same Re-index confirm dialog the header button
        // does — the backfill worker resets failed/pending photos and
        // re-enqueues them.
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {labels.failedPhotosWarning.replace('{count}', String(state.failed))}
          </span>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={!reindexEnabled || isPending}
            className="font-medium underline-offset-2 hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {labels.failedPhotosRetry}
          </button>
        </div>
      ) : null}
      {showSuccessFlash ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {labels.indexingComplete}
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
