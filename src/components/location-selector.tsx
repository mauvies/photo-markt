'use client';

import { Country, State } from 'country-state-city';
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface LocationSelectorProps {
  country: string;
  state: string;
  city: string;
  onCountryChange: (country: string) => void;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
  countryError?: string;
  stateError?: string;
  cityError?: string;
  showFeedback?: boolean;
  className?: string;
  hideCity?: boolean;
}

export function LocationSelector({
  country,
  state,
  city,
  onCountryChange,
  onStateChange,
  onCityChange,
  countryError,
  stateError,
  cityError,
  showFeedback = false,
  className,
  hideCity = false,
}: LocationSelectorProps) {
  // Get all countries sorted by name
  const countries = useMemo(() => {
    return Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Get states for selected country
  const states = useMemo(() => {
    if (!country) return [];
    return State.getStatesOfCountry(country).sort((a, b) => a.name.localeCompare(b.name));
  }, [country]);

  const handleCountryChange = (value: string) => {
    onCountryChange(value);
    // Reset state and city when country changes
    if (value !== country) {
      onStateChange('');
      onCityChange('');
    }
  };

  const handleStateChange = (value: string) => {
    onStateChange(value);
    // Reset city when state changes
    if (value !== state) {
      onCityChange('');
    }
  };

  const isCountryInvalid = showFeedback && countryError;
  const isStateInvalid = showFeedback && stateError;
  const isCityInvalid = showFeedback && cityError;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Country */}
      <div className="grid gap-2">
        <Label htmlFor="country">Country</Label>
        <Select value={country} onValueChange={handleCountryChange}>
          <SelectTrigger
            id="country"
            aria-invalid={!!isCountryInvalid}
            className={cn('w-full', isCountryInvalid && 'border-destructive')}
          >
            <SelectValue placeholder="Select a country" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.isoCode} value={c.isoCode}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isCountryInvalid && countryError ? (
          <p className="text-xs text-destructive">{countryError}</p>
        ) : null}
      </div>

      {/* State/Province */}
      <div className="grid gap-2">
        <Label htmlFor="state">State / Province</Label>
        {states.length > 0 ? (
          <Select value={state} onValueChange={handleStateChange}>
            <SelectTrigger
              id="state"
              aria-invalid={!!isStateInvalid}
              className={cn('w-full', isStateInvalid && 'border-destructive')}
            >
              <SelectValue placeholder="Select a state or province" />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s.isoCode} value={s.isoCode}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="state"
            value={state}
            onChange={(e) => handleStateChange(e.target.value)}
            placeholder="Enter state or province name"
            aria-invalid={!!isStateInvalid}
            className={cn(isStateInvalid && 'border-destructive')}
            autoComplete="address-level1"
            suppressHydrationWarning
          />
        )}
        {isStateInvalid && stateError ? (
          <p className="text-xs text-destructive">{stateError}</p>
        ) : null}
      </div>

      {/* City */}
      {!hideCity && (
        <div className="grid gap-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Enter city name"
            aria-invalid={!!isCityInvalid}
            className={cn(isCityInvalid && 'border-destructive')}
            autoComplete="address-level2"
            suppressHydrationWarning
          />
          {isCityInvalid && cityError ? (
            <p className="text-xs text-destructive">{cityError}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
