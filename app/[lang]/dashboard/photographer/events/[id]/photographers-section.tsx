'use client';

import { Loader2, UserPlus, X } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import type {
  EventPhotographerStatus,
  EventPhotographerWithProfile,
} from '@/database/queries/event-photographers';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { revokeEventPhotographerAction } from './actions';
import { InvitePhotographerDialog } from './invite-photographer-dialog';

type OrganizerEventT = Dictionary['organizerEvent'];

type PhotographersSectionProps = {
  eventId: string;
  initialPhotographers: EventPhotographerWithProfile[];
};

const STATUS_LABELS: Record<EventPhotographerStatus, keyof OrganizerEventT> = {
  pending: 'statusPending',
  accepted: 'statusAccepted',
  declined: 'statusDeclined',
  revoked: 'statusRevoked',
};

const STATUS_BADGE_CLASSES: Record<EventPhotographerStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  declined: 'bg-muted text-muted-foreground',
  revoked: 'bg-muted text-muted-foreground line-through',
};

export function PhotographersSection({ eventId, initialPhotographers }: PhotographersSectionProps) {
  const { t } = useTranslations<OrganizerEventT>();
  const [photographers, setPhotographers] = useState(initialPhotographers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleInvited = (row: EventPhotographerWithProfile) => {
    setPhotographers((prev) => [row, ...prev]);
  };

  const handleRevoke = (invitationId: string) => {
    setRevokingId(invitationId);
    startTransition(async () => {
      try {
        const result = await revokeEventPhotographerAction(invitationId, eventId);
        // The action returns the new state ('revoked') for accepted rows, and
        // null when it hard-deletes a pending row.
        setPhotographers((prev) => {
          if (!result) return prev.filter((p) => p.id !== invitationId);
          return prev.map((p) => (p.id === invitationId ? { ...p, status: 'revoked' } : p));
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to revoke');
      } finally {
        setRevokingId(null);
      }
    });
  };

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('photographersTabTitle')}</h2>
        <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          {t('inviteButton')}
        </Button>
      </header>

      {photographers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('photographersEmpty')}</p>
      ) : (
        <ul className="grid gap-2">
          {photographers.map((row) => {
            const name = row.profile?.display_name ?? row.profile?.username ?? '—';
            const handle = row.profile?.username ? `@${row.profile.username}` : null;
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  {handle && <p className="truncate text-xs text-muted-foreground">{handle}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASSES[row.status]}`}
                >
                  {t(STATUS_LABELS[row.status])}
                </span>
                {row.status !== 'declined' && row.status !== 'revoked' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('revokeAction')}
                        disabled={isPending && revokingId === row.id}
                      >
                        {isPending && revokingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('revokeConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('revokeConfirmDesc')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('revokeCancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRevoke(row.id)}>
                          {t('revokeConfirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <InvitePhotographerDialog
        eventId={eventId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        existingPhotographerIds={new Set(photographers.map((p) => p.photographer_id))}
        onInvited={handleInvited}
      />
    </section>
  );
}
