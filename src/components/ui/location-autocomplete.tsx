'use client';

/*
 * MANUAL GOOGLE CLOUD CONSOLE STEPS — do not automate (see .env.example):
 * 1. Enable BOTH APIs in photomarkt-staging and photomarkt-prod projects:
 *      - Maps JavaScript API   (loads the SDK)
 *      - Places API            (the actual autocomplete calls)
 * 2. Restrict NEXT_PUBLIC_GOOGLE_PLACES_API_KEY to HTTP referrers:
 *    https://photomarkt.com/*, https://www.photomarkt.com/*, http://localhost:3000/*
 * 3. Under "API restrictions", allow BOTH Maps JavaScript API AND Places API.
 *    Allowing only Places API yields ApiTargetBlockedMapError because the
 *    SDK loader call counts as a Maps JavaScript API request.
 * 4. Set daily quota limits on each API (1,000 staging / 5,000 prod).
 */

import { useEffect, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { usePlacesAutocomplete } from '@/hooks/use-places-autocomplete';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

type LocationParts = {
  city: string;
  state: string;
  country: string;
  formattedAddress: string;
};

type LocationAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  /** Fired when a Google prediction is selected, with the resolved city /
   * state / country parts so the form can persist them separately (T-107).
   * When provided, the `city` field receives just the city name (not the full
   * formatted address). Free-typed values still flow only through `onChange`. */
  onPlaceSelect?: (parts: LocationParts) => void;
  onBlur?: () => void;
  placeholder?: string;
  noResultsText?: string;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
};

export function LocationAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  onBlur,
  placeholder = 'Search for a location...',
  noResultsText = 'No locations found',
  id,
  className,
  'aria-invalid': ariaInvalid,
}: LocationAutocompleteProps) {
  const { isReady, getPredictions, getDetails } = usePlacesAutocomplete();
  const [inputValue, setInputValue] = useState(value);
  const [predictions, setPredictions] = useState<
    Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [fetchedFor, setFetchedFor] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Only auto-fetch + open the popover when the user has actively typed in
  // this component. Prop syncs (rehydration, parent reset, post-select sync)
  // and the initial mount must NOT open the popover.
  const userTypingRef = useRef(false);
  // Set when the value change came from this component (typing or select),
  // so the value-sync effect skips clobbering our local state.
  const internalChangeRef = useRef(false);

  const debouncedInput = useDebounce(inputValue, 300);

  // Sync external value changes (form reset, external setValue). We skip
  // the sync when WE caused the change (otherwise typing would clobber
  // userTypingRef and close the popover mid-stroke).
  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }
    setInputValue(value);
    setFetchedFor(value);
    userTypingRef.current = false;
  }, [value]);

  // Fetch predictions only after the user types something. Prop-driven
  // value changes never trigger a fetch.
  useEffect(() => {
    if (!userTypingRef.current) return;
    if (!isReady || debouncedInput.length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    if (debouncedInput === fetchedFor) return;
    setFetchedFor(debouncedInput);
    getPredictions(debouncedInput, { types: ['(regions)'] })
      .then((preds) => {
        setPredictions(preds);
        setOpen(preds.length > 0 || debouncedInput.length >= 3);
        setHighlightIndex(-1);
      })
      .catch(() => {
        setPredictions([]);
        setOpen(false);
      });
  }, [debouncedInput, isReady, getPredictions, fetchedFor]);

  const handleSelect = async (prediction: {
    placeId: string;
    description: string;
    mainText: string;
    secondaryText: string;
  }) => {
    // Critical: clear the typing flag BEFORE any state update so the
    // post-select debounce/render cycle can't reopen the popover.
    userTypingRef.current = false;
    internalChangeRef.current = true;
    setOpen(false);
    setPredictions([]);
    setHighlightIndex(-1);

    // Call getDetails to properly close the billing session token
    const details = await getDetails(prediction.placeId);

    // With a structured consumer (event forms), store the city / state /
    // country separately and show just the city name. Otherwise fall back to
    // the previous behavior — the full formatted address into `onChange`.
    if (details && onPlaceSelect) {
      const displayCity = details.city || prediction.mainText;
      setInputValue(displayCity);
      setFetchedFor(displayCity);
      onPlaceSelect({
        city: displayCity,
        state: details.state,
        country: details.country,
        formattedAddress: details.formattedAddress,
      });
      return;
    }

    const formatted = details?.formattedAddress ?? prediction.description;
    setInputValue(formatted);
    setFetchedFor(formatted);
    onChange(formatted);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    const total = predictions.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + total) % total);
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      const pred = predictions[highlightIndex];
      if (pred) void handleSelect(pred);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showNoResults = open && isReady && debouncedInput.length >= 3 && predictions.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-invalid={ariaInvalid}
          value={inputValue}
          onChange={(e) => {
            const v = e.target.value;
            // Allow the user to commit a custom (non-Place) value: propagate
            // every keystroke up to the parent form so validators run and the
            // user can advance even without selecting a Google prediction.
            userTypingRef.current = true;
            internalChangeRef.current = true;
            setInputValue(v);
            onChange(v);
            if (v.length < 3) {
              setPredictions([]);
              setOpen(false);
            }
          }}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          suppressHydrationWarning
          className={cn('text-left text-sm', className)}
        />
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[--radix-popover-trigger-width] p-0 overflow-hidden"
      >
        <div>
          {predictions.map((p, i) => (
            <button
              key={p.placeId}
              type="button"
              role="option"
              aria-selected={i === highlightIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleSelect(p)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-sm text-left transition-colors hover:bg-muted',
                i === highlightIndex && 'bg-muted',
              )}
            >
              <span className="font-medium">{p.mainText}</span>
              {p.secondaryText && (
                <span className="text-muted-foreground">,&nbsp;{p.secondaryText}</span>
              )}
            </button>
          ))}
          {showNoResults && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{noResultsText}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
