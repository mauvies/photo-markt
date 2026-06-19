'use client';

import { Search, User } from 'lucide-react';
import type {
  EventSuggestion,
  PhotographerSearchResult,
} from '@/app/[lang]/dashboard/talent/events/actions';

interface WhereSuggestionsDropdownProps {
  events: EventSuggestion[];
  photographers: PhotographerSearchResult[];
  hasInput: boolean;
  onSelectEvent: (event: EventSuggestion) => void;
  onSelectPhotographer: (slug: string) => void;
  t: {
    eventsLabel: string;
    photographersLabel: string;
  };
}

export function WhereSuggestionsDropdown({
  events,
  photographers,
  hasInput,
  onSelectEvent,
  onSelectPhotographer,
  t,
}: WhereSuggestionsDropdownProps) {
  const showEvents = hasInput && events.length > 0;
  const showPhotographers = hasInput && photographers.length > 0;

  if (!showEvents && !showPhotographers) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border bg-popover shadow-xl">
      {showEvents && (
        <>
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-left">
            {t.eventsLabel}
          </p>
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectEvent(event);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{event.name}</span>
                {event.city && <span className="text-muted-foreground"> · {event.city}</span>}
              </span>
            </button>
          ))}
        </>
      )}

      {showEvents && showPhotographers && <div className="mx-4 my-1 h-px bg-border" />}

      {showPhotographers && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-left">
            {t.photographersLabel}
          </p>
          {photographers.map((p) => (
            <button
              key={p.username}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectPhotographer(p.slug);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                {p.display_name ? (
                  <>
                    <span className="font-medium">{p.display_name}</span>
                    <span className="text-muted-foreground"> @{p.username}</span>
                  </>
                ) : (
                  <span className="font-medium">@{p.username}</span>
                )}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
