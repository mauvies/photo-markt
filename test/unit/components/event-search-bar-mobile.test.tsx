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
const searchSuggestionsAction = vi.fn(async (_query: string) => ({
  events: [],
  photographers: [],
}));
type PhotographerRow = {
  id: string;
  username: string;
  slug: string;
  display_name: string | null;
  avatar_url: string | null;
  event_count: number;
};
const searchPhotographersAction = vi.fn(async (_query: string): Promise<PhotographerRow[]> => []);
vi.mock('@/app/[lang]/dashboard/talent/events/actions', () => ({
  searchSuggestionsAction: (query: string) => searchSuggestionsAction(query),
  searchPhotographersAction: (query: string) => searchPhotographersAction(query),
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
  searchPhotographersAction.mockClear();
  searchPhotographersAction.mockResolvedValue([]);
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

describe('filters modal — Activity is a select, not a typeahead', () => {
  // Regression: Activity was a free-text combobox. Typing that matched no
  // option produced a shake animation and a `validate()` that aborted the
  // search on submit — a dead end a fixed option list cannot reach.
  it('offers no typeable Activity field', async () => {
    renderBar();
    openFiltersSheet();

    await screen.findByText(en.eventSearchBar.activityLabel);
    // The placeholder used to belong to an <input>; it is now the button's
    // resting label.
    const placeholder = screen.getAllByText(en.eventSearchBar.activityPlaceholder)[0];
    expect(placeholder.closest('button')).not.toBeNull();
    expect(screen.queryByPlaceholderText(en.eventSearchBar.activityPlaceholder)).toBeNull();
  });

  it('expands and collapses the option list on tap, and picking one sets the field', async () => {
    renderBar();
    openFiltersSheet();

    await screen.findByText(en.eventSearchBar.activityLabel);
    const trigger = screen
      .getAllByText(en.eventSearchBar.activityPlaceholder)[0]
      .closest('button') as HTMLButtonElement;

    // Collapsed: no options rendered.
    expect(screen.queryByRole('button', { name: 'Surf' })).toBeNull();

    fireEvent.click(trigger);
    const option = screen.getByRole('button', { name: 'Surf' });
    expect(option).toBeTruthy();

    // Tapping the field again collapses it without changing the value.
    fireEvent.click(trigger);
    expect(screen.queryByRole('button', { name: 'Surf' })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Surf' }));

    // Selecting collapses the list and shows the label in the field.
    expect(screen.queryByRole('button', { name: 'Surf' })).toBeNull();
    expect(screen.getAllByText('Surf').length).toBeGreaterThan(0);
  });

  it('submits the selected activity as its option value', async () => {
    renderBar();
    openFiltersSheet();

    await screen.findByText(en.eventSearchBar.activityLabel);
    const trigger = screen
      .getAllByText(en.eventSearchBar.activityPlaceholder)[0]
      .closest('button') as HTMLButtonElement;
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Surf' }));
    fireEvent.click(screen.getAllByRole('button', { name: en.eventSearchBar.searchButton })[0]);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain('activity=SURF');
  });
});

describe('filters modal — photographer suggestions', () => {
  const ana: PhotographerRow = {
    id: 'p1',
    username: 'anaphoto',
    slug: 'anaphoto',
    display_name: 'Ana Pérez',
    avatar_url: null,
    event_count: 3,
  };

  // Regression: this field shipped as a bare text input. `?photographer=` always
  // filtered correctly, but NOTHING ever queried the roster — typing the name of
  // a photographer who demonstrably exists offered no suggestion, because none
  // was ever wired.
  it('queries the roster and offers a match while typing', async () => {
    searchPhotographersAction.mockResolvedValue([ana]);
    renderBar();
    openFiltersSheet();

    const input = (
      await screen.findAllByPlaceholderText(en.eventSearchBar.photographerPlaceholder)
    )[0];
    fireEvent.change(input, { target: { value: 'ana' } });

    await waitFor(() => {
      expect(searchPhotographersAction).toHaveBeenCalledWith('ana');
    });
    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText('@anaphoto')).toBeTruthy();
  });

  it('fills the field with a value the server-side filter matches, and submits it', async () => {
    searchPhotographersAction.mockResolvedValue([ana]);
    renderBar();
    openFiltersSheet();

    const input = (
      await screen.findAllByPlaceholderText(en.eventSearchBar.photographerPlaceholder)
    )[0];
    fireEvent.change(input, { target: { value: 'ana' } });
    fireEvent.mouseDown(await screen.findByText('Ana Pérez'));

    // `display_name` — one of the two columns `searchPublicEvents` matches on.
    expect((input as HTMLInputElement).value).toBe('Ana Pérez');

    fireEvent.click(screen.getAllByRole('button', { name: en.eventSearchBar.searchButton })[0]);
    expect(push).toHaveBeenCalledTimes(1);
    // URLSearchParams form-encodes the space as `+`.
    expect(push.mock.calls[0][0]).toContain('photographer=Ana+P%C3%A9rez');
  });

  it('does not query on an empty field', async () => {
    renderBar();
    openFiltersSheet();

    await screen.findAllByPlaceholderText(en.eventSearchBar.photographerPlaceholder);
    await waitFor(() => {
      expect(searchPhotographersAction).not.toHaveBeenCalled();
    });
  });
});
