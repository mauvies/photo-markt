/** @vitest-environment happy-dom */
/**
 * Regression tests for the mobile search sheet + filters modal that
 * `EventSearchBar` owns on the home page.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ lang: 'en' }),
}));

// Server actions reach for supabaseAdmin — stub the whole module so the client
// component renders in happy-dom.
const searchSuggestionsAction = vi.fn(async () => ({ events: [], photographers: [] }));
vi.mock('@/app/[lang]/dashboard/talent/events/actions', () => ({
  searchSuggestionsAction: (...args: unknown[]) => searchSuggestionsAction(...args),
}));

import { EventSearchBar } from '@/components/event-search-bar';
import { TranslationsProvider } from '@/lib/i18n/translations-provider';

function renderBar() {
  return render(
    <TranslationsProvider translations={en.eventSearchBar}>
      <EventSearchBar variant="hero" searchHref="/en" accessCodeHref="/en/events" />
    </TranslationsProvider>,
  );
}

/** The mobile sheet's "Search your event" trigger. */
function openSearchSheet() {
  fireEvent.click(screen.getByRole('button', { name: en.eventSearchBar.mobileText }));
}

/** The mobile sheet's Filters (sliders) trigger. Both the mobile and desktop
 *  bars are in the DOM (only CSS hides one), and both expose the same
 *  accessible name — the mobile one comes first. */
function openFiltersSheet() {
  fireEvent.click(screen.getAllByRole('button', { name: en.eventSearchBar.filters })[0]);
}

beforeEach(() => {
  push.mockClear();
  searchSuggestionsAction.mockClear();
});

afterEach(cleanup);

describe('mobile search sheet — initial focus', () => {
  // Regression: Radix's default auto-focus landed on the sheet's ✕ button, so
  // tapping "Search your event" opened a sheet with no keyboard and the user
  // had to tap the field a second time before they could type.
  it('focuses the Where input when opened from "Search your event"', async () => {
    renderBar();
    openSearchSheet();

    const input = await screen.findByPlaceholderText(en.eventSearchBar.wherePlaceholder);
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it('does not steal focus into the Where input when opened from Filters', async () => {
    renderBar();
    openFiltersSheet();

    const input = await screen.findByPlaceholderText(en.eventSearchBar.wherePlaceholder);
    // The filter cards are the target here; raising the keyboard would cover
    // them, so the Where field must NOT grab the caret.
    await waitFor(() => {
      expect(screen.getByText(en.eventSearchBar.activityLabel)).toBeTruthy();
    });
    expect(document.activeElement).not.toBe(input);
  });
});
