import { describe, expect, it } from 'vitest';
import { isValidUsername, normalizeUsername } from '@/lib/username';

describe('normalizeUsername', () => {
  it('lowercases mixed-case input', () => {
    expect(normalizeUsername('SurferJane')).toBe('surferjane');
  });

  it('strips spaces', () => {
    expect(normalizeUsername('surfer jane')).toBe('surferjane');
  });

  it('strips punctuation outside [a-z0-9_-]', () => {
    expect(normalizeUsername('Surfer Jane!')).toBe('surferjane');
    expect(normalizeUsername('a.b@c#d')).toBe('abcd');
  });

  it('keeps underscores and hyphens', () => {
    expect(normalizeUsername('studio_lopez-01')).toBe('studio_lopez-01');
  });

  it('returns an empty string when nothing survives', () => {
    expect(normalizeUsername('!!!')).toBe('');
  });
});

describe('isValidUsername', () => {
  it('accepts a normalized value within bounds', () => {
    expect(isValidUsername('surfer_jane')).toBe(true);
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('a'.repeat(30))).toBe(true);
  });

  it('rejects values shorter than 3 characters', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('ab')).toBe(false);
  });

  it('rejects values longer than 30 characters', () => {
    expect(isValidUsername('a'.repeat(31))).toBe(false);
  });

  it('rejects values with characters outside the allowed set', () => {
    expect(isValidUsername('Surfer')).toBe(false); // uppercase
    expect(isValidUsername('surfer jane')).toBe(false); // space
    expect(isValidUsername('surfer.jane')).toBe(false); // dot
  });
});
