'use client';

import { User } from 'lucide-react';
import type { PhotographerSearchResult } from '@/app/[lang]/dashboard/talent/events/actions';

/**
 * Suggestion list for the filter modal's "Photographers" field.
 *
 * Unlike `WhereSuggestionsDropdown` — whose photographer rows NAVIGATE to a
 * profile — picking here fills the filter, so the caller gets the row back and
 * decides what text to store. The value it stores must be one the server-side
 * filter can match (`profiles.username` OR `profiles.display_name`).
 *
 * Rendered inline as the bottom half of the field's card (not an absolute
 * overlay) so it behaves like the Activity list in the same modal and can't be
 * clipped by the dialog's own scroll container.
 */
export function PhotographerSuggestions({
  options,
  onSelect,
}: {
  options: PhotographerSearchResult[];
  onSelect: (photographer: PhotographerSearchResult) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="max-h-48 overflow-y-auto border-t py-1">
      {options.map((p) => (
        <button
          key={p.id}
          type="button"
          // `onMouseDown` + preventDefault so the pick lands before the
          // input's blur dismisses the list — the same idiom the Where
          // suggestions use.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(p);
          }}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted"
        >
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">
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
    </div>
  );
}

/** The text a picked suggestion puts in the field. `display_name` when the
 *  photographer has one, else the username — both are columns the server-side
 *  photographer filter matches on, so what the user sees is what filters. */
export function photographerFilterValue(p: PhotographerSearchResult): string {
  return p.display_name?.trim() || p.username;
}
