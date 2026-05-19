'use client';

import { Calendar, Loader2, MapPin } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { PendingInvitationForPhotographer } from '@/database/queries/event-photographers';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import { respondToEventInvitationAction } from './[id]/actions';

type OrganizerEventT = Dictionary['organizerEvent'];

type PendingInvitationsPanelProps = {
  initialInvitations: PendingInvitationForPhotographer[];
};

export function PendingInvitationsPanel({ initialInvitations }: PendingInvitationsPanelProps) {
  const { t } = useTranslations<OrganizerEventT>();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (invitations.length === 0) return null;

  const respond = (invitationId: string, status: 'accepted' | 'declined') => {
    setRespondingId(invitationId);
    startTransition(async () => {
      try {
        await respondToEventInvitationAction(invitationId, status);
        // Optimistically drop the row from the panel; the events list itself
        // is server-rendered and a refresh would surface the accepted event.
        setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed');
      } finally {
        setRespondingId(null);
      }
    });
  };

  return (
    <section className="mb-6 rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold">{t('pendingInvitationsTitle')}</h2>
      <ul className="grid gap-3">
        {invitations.map((inv) => {
          const event = inv.event;
          if (!event) return null;
          const organizerName = event.organizer?.display_name ?? event.organizer?.username ?? '—';
          const isResponding = respondingId === inv.id;
          return (
            <li
              key={inv.id}
              className="flex flex-col gap-3 rounded-md border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium md:text-sm">{event.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground md:text-xs">
                  {t('invitationFromOrganizer').replace('{name}', organizerName)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground md:text-xs">
                  {event.date && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(event.date).toDateString().split(' ').slice(1).join(' ')}
                    </span>
                  )}
                  {event.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {event.city}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isResponding}
                  onClick={() => respond(inv.id, 'declined')}
                >
                  {t('inviteDeclineButton')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isResponding}
                  onClick={() => respond(inv.id, 'accepted')}
                >
                  {isResponding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('inviteAcceptButton')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
