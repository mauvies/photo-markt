/** @vitest-environment happy-dom */
/**
 * T-107 — selecting a Google prediction must surface the parsed city / state /
 * country to the form via `onPlaceSelect` (previously the full formatted
 * address was dumped into a single `onChange` string and state/country lost).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Identity debounce so typing resolves synchronously in the test.
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: unknown) => v }));

const getDetails = vi.fn(async () => ({
  lat: 41.3851,
  lng: 2.1734,
  city: 'Barcelona',
  state: 'Catalonia',
  country: 'Spain',
  formattedAddress: 'Barcelona, Spain',
}));

vi.mock('@/hooks/use-places-autocomplete', () => ({
  isMockMode: true,
  usePlacesAutocomplete: () => ({
    isReady: true,
    getPredictions: vi.fn(async () => [
      {
        placeId: 'p1',
        description: 'Barcelona, Spain',
        mainText: 'Barcelona',
        secondaryText: 'Spain',
      },
    ]),
    getDetails,
  }),
}));

import { LocationAutocomplete } from '@/components/ui/location-autocomplete';

afterEach(() => {
  cleanup();
  getDetails.mockClear();
});

describe('LocationAutocomplete onPlaceSelect (T-107)', () => {
  it('emits the parsed city / state / country when a prediction is picked', async () => {
    const onChange = vi.fn();
    const onPlaceSelect = vi.fn();
    render(<LocationAutocomplete value="" onChange={onChange} onPlaceSelect={onPlaceSelect} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Barcelona' } });

    const option = await screen.findByRole('option', { name: /Barcelona/ });
    fireEvent.click(option);

    await waitFor(() =>
      expect(onPlaceSelect).toHaveBeenCalledWith({
        city: 'Barcelona',
        state: 'Catalonia',
        country: 'Spain',
        formattedAddress: 'Barcelona, Spain',
      }),
    );
  });
});
