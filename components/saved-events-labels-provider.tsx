'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * Visible strings for the event save/unsave button. Provided once at the root
 * layout so the button — which appears on statically-rendered public pages
 * (home, /events) and inside the talent dashboard — can read localized labels
 * without each card consumer prop-drilling them. Kept separate from the main
 * `TranslationsProvider` context so it never clashes with a page's own
 * translation slice.
 */
export type SavedEventsLabels = {
  save: string;
  saved: string;
  savedToast: string;
  removedToast: string;
  failedSave: string;
  failedRemove: string;
};

const DEFAULTS: SavedEventsLabels = {
  save: 'Save event',
  saved: 'Saved',
  savedToast: 'Event saved',
  removedToast: 'Event removed',
  failedSave: 'Failed to save event',
  failedRemove: 'Failed to remove event',
};

const SavedEventsLabelsContext = createContext<SavedEventsLabels>(DEFAULTS);

export function SavedEventsLabelsProvider({
  labels,
  children,
}: {
  labels: SavedEventsLabels;
  children: ReactNode;
}) {
  return (
    <SavedEventsLabelsContext.Provider value={labels}>{children}</SavedEventsLabelsContext.Provider>
  );
}

export function useSavedEventsLabels(): SavedEventsLabels {
  return useContext(SavedEventsLabelsContext);
}
