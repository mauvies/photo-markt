'use client';

import { MapPin, Navigation, Search, User } from 'lucide-react';
import type { PhotographerSearchResult } from '@/app/[lang]/dashboard/talent/events/actions';
import type { PlacePrediction } from '@/hooks/use-places-autocomplete';

interface WhereSuggestionsDropdownProps {
  placePredictions: PlacePrediction[];
  eventNames: string[];
  photographers: PhotographerSearchResult[];
  hasInput: boolean;
  onSelectPlace: (p: PlacePrediction) => void;
  onSelectEventName: (name: string) => void;
  onSelectPhotographer: (slug: string) => void;
  onUseCurrentLocation: () => void;
  t: {
    useCurrentLocation: string;
    locationsLabel: string;
    eventsLabel: string;
    photographersLabel: string;
  };
}

export function WhereSuggestionsDropdown({
  placePredictions,
  eventNames,
  photographers,
  hasInput,
  onSelectPlace,
  onSelectEventName,
  onSelectPhotographer,
  onUseCurrentLocation,
  t,
}: WhereSuggestionsDropdownProps) {
  const showPlaces = hasInput && placePredictions.length > 0;
  const showEvents = hasInput && eventNames.length > 0;
  const showPhotographers = hasInput && photographers.length > 0;
  const showCurrentLocation =
    !hasInput && typeof navigator !== 'undefined' && !!navigator.geolocation;

  if (!showPlaces && !showEvents && !showPhotographers && !showCurrentLocation) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border bg-popover shadow-xl">
      {showCurrentLocation && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onUseCurrentLocation();
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
        >
          <Navigation className="h-4 w-4 shrink-0 text-primary" />
          {t.useCurrentLocation}
        </button>
      )}

      {showPlaces && (
        <>
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t.locationsLabel}
          </p>
          {placePredictions.map((p) => (
            <button
              key={p.placeId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectPlace(p);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{p.mainText}</span>
                {p.secondaryText && (
                  <span className="text-muted-foreground">, {p.secondaryText}</span>
                )}
              </span>
            </button>
          ))}
        </>
      )}

      {showPlaces && showEvents && <div className="mx-4 my-1 h-px bg-border" />}

      {showEvents && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t.eventsLabel}
          </p>
          {eventNames.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectEventName(name);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {name}
            </button>
          ))}
        </>
      )}

      {(showPlaces || showEvents) && showPhotographers && (
        <div className="mx-4 my-1 h-px bg-border" />
      )}
      {showPhotographers && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
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
