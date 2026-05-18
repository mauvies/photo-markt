'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
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
import { reindexEvent } from './actions';

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
  };
}

export function AiStatusCard({
  eventId,
  status,
  totalApplicable,
  indexed,
  pending: _pending,
  failed,
  lastIndexedAt,
  labels,
}: AiStatusCardProps) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusLabel =
    status === 'idle'
      ? labels.statusIdle
      : status === 'indexing'
        ? labels.statusIndexing
        : status === 'ready'
          ? labels.statusReady
          : labels.statusFailed;

  const reindexEnabled = status === 'ready' || status === 'failed';

  const triggerReindex = () => {
    setDialogOpen(false);
    startTransition(async () => {
      try {
        await reindexEvent(eventId);
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
          <Badge variant={status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel}</Badge>
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
          .replace('{count}', String(indexed))
          .replace('{total}', String(totalApplicable))}
        {failed > 0 ? ` · ${failed} failed` : ''}
      </p>
      {lastIndexedAt && (
        <p className="text-xs text-muted-foreground">
          {labels.lastIndexed.replace('{at}', new Date(lastIndexedAt).toLocaleString())}
        </p>
      )}
    </section>
  );
}
