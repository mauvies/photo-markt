'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { EventPhotographerWithProfile } from '@/database/queries/event-photographers';
import type { Dictionary } from '@/lib/i18n/get-dictionary';
import { useTranslations } from '@/lib/i18n/translations-provider';
import {
  inviteEventPhotographerAction,
  type PhotographerSearchHit,
  searchPhotographersAction,
} from './actions';

type OrganizerEventT = Dictionary['organizerEvent'];

type InvitePhotographerDialogProps = {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Photographer IDs already on the list — used to grey out "already invited"
  // hits so the organizer doesn't double-invite.
  existingPhotographerIds: Set<string>;
  onInvited: (row: EventPhotographerWithProfile) => void;
};

export function InvitePhotographerDialog({
  eventId,
  open,
  onOpenChange,
  existingPhotographerIds,
  onInvited,
}: InvitePhotographerDialogProps) {
  const { t } = useTranslations<OrganizerEventT>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhotographerSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
  }, [open]);

  // Debounce the search by ~250ms; cancel previous in-flight requests by
  // tracking the active query string.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const handle = setTimeout(async () => {
      try {
        const hits = await searchPhotographersAction(trimmed);
        if (!cancelled) setResults(hits);
      } catch (error) {
        if (!cancelled) {
          console.error('Photographer search failed', error);
          setResults([]);
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open]);

  const invite = (hit: PhotographerSearchHit) => {
    if (existingPhotographerIds.has(hit.id)) {
      toast.error(t('inviteAlreadyExists'));
      return;
    }
    setInvitingId(hit.id);
    startTransition(async () => {
      try {
        const row = await inviteEventPhotographerAction(eventId, hit.id);
        onInvited({
          ...row,
          profile: {
            id: hit.id,
            username: hit.username,
            slug: hit.slug,
            display_name: hit.display_name,
            avatar_url: hit.avatar_url,
          },
        });
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to invite');
      } finally {
        setInvitingId(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inviteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('inviteDialogDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPhotographersPlaceholder')}
              className="pl-9"
            />
          </div>

          <div className="min-h-[8rem]">
            {query.trim().length < 2 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('searchTypeToStart')}
              </p>
            ) : isSearching ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('searchNoResults')}
              </p>
            ) : (
              <ul className="grid gap-1 max-h-72 overflow-y-auto pr-1">
                {results.map((hit) => {
                  const alreadyInvited = existingPhotographerIds.has(hit.id);
                  const isInviting = invitingId === hit.id;
                  return (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => !alreadyInvited && invite(hit)}
                        disabled={alreadyInvited || isInviting}
                        className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                      >
                        <Avatar className="h-9 w-9">
                          {hit.avatar_url && (
                            <AvatarImage src={hit.avatar_url} alt={hit.display_name ?? ''} />
                          )}
                          <AvatarFallback>
                            {(hit.display_name ?? hit.username ?? '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {hit.display_name ?? hit.username}
                          </p>
                          {hit.username && (
                            <p className="truncate text-xs text-muted-foreground">
                              @{hit.username}
                            </p>
                          )}
                        </div>
                        {alreadyInvited ? (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            ✓
                          </span>
                        ) : isInviting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('revokeCancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
