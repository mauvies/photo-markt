'use client';

/*
 * MANUAL GOOGLE CLOUD CONSOLE STEPS — do not automate (see .env.example):
 * 1. Enable "Places API" in picdemi-staging and picdemi-prod projects.
 * 2. Restrict NEXT_PUBLIC_GOOGLE_PLACES_API_KEY to HTTP referrers:
 *    https://picdemi.com/*, https://www.picdemi.com/*, http://localhost:3000/*
 * 3. Restrict the key to "Places API" only.
 * 4. Set daily quota limits (1,000 staging / 5,000 prod).
 */

import { useEffect, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { usePlacesAutocomplete } from '@/hooks/use-places-autocomplete';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

type LocationAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
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
  const [fetchedFor, setFetchedFor] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedInput = useDebounce(inputValue, 300);

  // Sync external value changes (e.g. form reset)
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Fetch predictions
  useEffect(() => {
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
    setOpen(false);
    setPredictions([]);
    setHighlightIndex(-1);

    // Call getDetails to properly close the billing session token
    const details = await getDetails(prediction.placeId);
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
            setInputValue(v);
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
          className={cn('text-left', className)}
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
                'flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-muted',
                i === highlightIndex && 'bg-muted',
              )}
            >
              <span className="font-medium">{p.mainText}</span>
              {p.secondaryText && (
                <span className="text-muted-foreground">, {p.secondaryText}</span>
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
