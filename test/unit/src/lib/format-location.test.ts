import { describe, expect, it } from 'vitest';
import { formatEventLocation } from '@/lib/format-location';

describe('formatEventLocation (T-107)', () => {
  it('joins city, state and country', () => {
    expect(formatEventLocation({ city: 'Barcelona', state: 'Catalonia', country: 'Spain' })).toBe(
      'Barcelona, Catalonia, Spain',
    );
  });

  it('skips a missing state (clean "city, country" fallback)', () => {
    expect(formatEventLocation({ city: 'Barcelona', state: '', country: 'Spain' })).toBe(
      'Barcelona, Spain',
    );
    expect(formatEventLocation({ city: 'Barcelona', country: 'Spain' })).toBe('Barcelona, Spain');
  });

  it('collapses a duplicate part (city === state)', () => {
    expect(formatEventLocation({ city: 'Lisbon', state: 'Lisbon', country: 'Portugal' })).toBe(
      'Lisbon, Portugal',
    );
  });

  it('renders a legacy event (formatted city, empty state/country) unchanged', () => {
    expect(formatEventLocation({ city: 'Barcelona, Spain', state: '', country: '' })).toBe(
      'Barcelona, Spain',
    );
  });

  it('trims parts and returns empty string when nothing is set', () => {
    expect(formatEventLocation({ city: '  Madrid  ', state: null, country: undefined })).toBe(
      'Madrid',
    );
    expect(formatEventLocation({ city: '', state: '', country: '' })).toBe('');
    expect(formatEventLocation({})).toBe('');
  });
});
