import { describe, expect, it } from 'vitest';
import { countryFlagEmoji } from '@/lib/country-flag';

describe('countryFlagEmoji', () => {
  it('maps English country names to flags', () => {
    expect(countryFlagEmoji('Spain')).toBe('🇪🇸');
    expect(countryFlagEmoji('United States')).toBe('🇺🇸');
    expect(countryFlagEmoji('Mexico')).toBe('🇲🇽');
  });

  it('maps Spanish country names (accent-insensitive)', () => {
    expect(countryFlagEmoji('España')).toBe('🇪🇸');
    expect(countryFlagEmoji('Estados Unidos')).toBe('🇺🇸');
    expect(countryFlagEmoji('México')).toBe('🇲🇽');
  });

  it('accepts a 2-letter ISO code directly', () => {
    expect(countryFlagEmoji('ES')).toBe('🇪🇸');
    expect(countryFlagEmoji('us')).toBe('🇺🇸');
  });

  it('returns null for empty or unknown input (no guessing)', () => {
    expect(countryFlagEmoji('')).toBeNull();
    expect(countryFlagEmoji(null)).toBeNull();
    expect(countryFlagEmoji(undefined)).toBeNull();
    expect(countryFlagEmoji('Some Formatted Address, 123')).toBeNull();
  });
});
