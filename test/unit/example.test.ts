/**
 * Example unit test — pure function, no DB, no mocks.
 *
 * Pattern for future unit tests:
 *   1. Pick a pure function (or factor one out from a larger function so it
 *      stays pure). Pure = same inputs → same outputs, no I/O, no globals.
 *   2. Cover the happy path + the interesting edge cases. Don't pad with
 *      duplicates that don't reveal a new branch.
 *   3. Co-locate `*.test.ts` next to the source under `lib/` or `__tests__/`,
 *      OR put it under `test/unit/` when the function under test crosses
 *      module boundaries.
 */

import { describe, expect, it } from 'vitest';
import { generateEventSlug, slugify } from '@/lib/slugify';

describe('slugify', () => {
  it('strips Spanish accents and normalizes case', () => {
    expect(slugify('Maratón de Tarragona')).toBe('maraton-de-tarragona');
  });

  it('strips German umlauts (ü → u)', () => {
    expect(slugify('Triathlon Zürich!')).toBe('triathlon-zurich');
  });

  it('replaces ñ explicitly (NFD does not decompose it)', () => {
    expect(slugify('Año Nuevo')).toBe('ano-nuevo');
  });

  it('collapses whitespace runs and trims', () => {
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });

  it('drops non-alphanumeric punctuation', () => {
    expect(slugify('Run & Ride 2026!')).toBe('run-ride-2026');
  });
});

describe('generateEventSlug', () => {
  it('composes name + city + year', () => {
    expect(generateEventSlug('Maratón Tarragona', 'Tarragona', 2026)).toBe(
      'maraton-tarragona-tarragona-2026',
    );
  });

  it('appends an optional suffix for disambiguation', () => {
    expect(generateEventSlug('Maratón Tarragona', 'Tarragona', 2026, 'a3f9b2')).toBe(
      'maraton-tarragona-tarragona-2026-a3f9b2',
    );
  });

  it('collapses repeated hyphens that arise from empty parts', () => {
    // City is empty after slugify → no double-dash in the output.
    expect(generateEventSlug('Solo Run', '', 2026)).toBe('solo-run-2026');
  });
});
