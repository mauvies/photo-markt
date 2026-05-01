'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlacePrediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type PlaceDetails = {
  lat: number;
  lng: number;
  city: string;
  formattedAddress: string;
};

// ─── Mock data (used when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is absent) ──────────

const MOCK_PREDICTIONS: PlacePrediction[] = [
  {
    placeId: 'mock-bcn',
    description: 'Barcelona, Spain',
    mainText: 'Barcelona',
    secondaryText: 'Spain',
  },
  { placeId: 'mock-mad', description: 'Madrid, Spain', mainText: 'Madrid', secondaryText: 'Spain' },
  {
    placeId: 'mock-tar',
    description: 'Tarragona, Spain',
    mainText: 'Tarragona',
    secondaryText: 'Spain',
  },
  {
    placeId: 'mock-nyc',
    description: 'New York, NY, USA',
    mainText: 'New York',
    secondaryText: 'NY, USA',
  },
  { placeId: 'mock-ldn', description: 'London, UK', mainText: 'London', secondaryText: 'UK' },
  { placeId: 'mock-par', description: 'Paris, France', mainText: 'Paris', secondaryText: 'France' },
  {
    placeId: 'mock-lis',
    description: 'Lisbon, Portugal',
    mainText: 'Lisbon',
    secondaryText: 'Portugal',
  },
  {
    placeId: 'mock-mia',
    description: 'Miami, FL, USA',
    mainText: 'Miami',
    secondaryText: 'FL, USA',
  },
];

const MOCK_DETAILS: Record<string, PlaceDetails> = {
  'mock-bcn': {
    lat: 41.3851,
    lng: 2.1734,
    city: 'Barcelona',
    formattedAddress: 'Barcelona, Spain',
  },
  'mock-mad': { lat: 40.4168, lng: -3.7038, city: 'Madrid', formattedAddress: 'Madrid, Spain' },
  'mock-tar': {
    lat: 41.1189,
    lng: 1.2445,
    city: 'Tarragona',
    formattedAddress: 'Tarragona, Spain',
  },
  'mock-nyc': {
    lat: 40.7128,
    lng: -74.006,
    city: 'New York',
    formattedAddress: 'New York, NY, USA',
  },
  'mock-ldn': { lat: 51.5074, lng: -0.1278, city: 'London', formattedAddress: 'London, UK' },
  'mock-par': { lat: 48.8566, lng: 2.3522, city: 'Paris', formattedAddress: 'Paris, France' },
  'mock-lis': { lat: 38.7169, lng: -9.1395, city: 'Lisbon', formattedAddress: 'Lisbon, Portugal' },
  'mock-mia': { lat: 25.7617, lng: -80.1918, city: 'Miami', formattedAddress: 'Miami, FL, USA' },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
export const isMockMode = !API_KEY;

export function usePlacesAutocomplete() {
  const [isReady, setIsReady] = useState(isMockMode);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  // Session token: groups all autocomplete keystrokes + the final getDetails call
  // into a single billable session, significantly reducing API costs.
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    if (isMockMode) return;
    loadGoogleMaps(API_KEY)
      .then(() => {
        serviceRef.current = new google.maps.places.AutocompleteService();
        setIsReady(true);
      })
      .catch(console.error);
  }, []);

  /** Returns the current session token, creating one on the first keystroke. */
  const getOrCreateToken = useCallback(() => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  /** Resets the token after a place is selected (starts a fresh session). */
  const resetToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  /** Fetch place predictions for the given input string. */
  const getPredictions = useCallback(
    (input: string, options?: { types?: string[] }): Promise<PlacePrediction[]> => {
      if (!input.trim()) return Promise.resolve([]);

      if (isMockMode) {
        const lower = input.toLowerCase();
        return Promise.resolve(
          MOCK_PREDICTIONS.filter((p) => p.description.toLowerCase().includes(lower)).slice(0, 5),
        );
      }

      if (!serviceRef.current) return Promise.resolve([]);

      return new Promise((resolve) => {
        serviceRef.current!.getPlacePredictions(
          {
            input,
            types: options?.types ?? ['(cities)'],
            sessionToken: getOrCreateToken(),
          },
          (predictions, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
              resolve([]);
              return;
            }
            resolve(
              predictions.slice(0, 5).map((p) => ({
                placeId: p.place_id,
                description: p.description,
                mainText: p.structured_formatting.main_text,
                secondaryText: p.structured_formatting.secondary_text ?? '',
              })),
            );
          },
        );
      });
    },
    [getOrCreateToken],
  );

  /**
   * Fetch lat/lng + city name for a selected place.
   * Uses (and then resets) the current session token so the
   * entire autocomplete session is billed as one request.
   */
  const getDetails = useCallback(
    (placeId: string): Promise<PlaceDetails | null> => {
      if (isMockMode) {
        resetToken();
        return Promise.resolve(MOCK_DETAILS[placeId] ?? null);
      }

      if (!window.google?.maps) return Promise.resolve(null);

      const token = sessionTokenRef.current;
      resetToken();

      const div = document.createElement('div');
      const placesService = new google.maps.places.PlacesService(div);

      return new Promise((resolve) => {
        placesService.getDetails(
          {
            placeId,
            fields: ['geometry', 'name', 'formatted_address', 'address_components'],
            sessionToken: token ?? undefined,
          },
          (place, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
              resolve(null);
              return;
            }

            const lat = place.geometry?.location?.lat() ?? 0;
            const lng = place.geometry?.location?.lng() ?? 0;

            const city =
              place.address_components?.find(
                (c) =>
                  c.types.includes('locality') ||
                  c.types.includes('administrative_area_level_2') ||
                  c.types.includes('administrative_area_level_1'),
              )?.long_name ??
              place.name ??
              '';

            resolve({
              lat,
              lng,
              city,
              formattedAddress: place.formatted_address ?? city,
            });
          },
        );
      });
    },
    [resetToken],
  );

  return { isReady, getPredictions, getDetails };
}
