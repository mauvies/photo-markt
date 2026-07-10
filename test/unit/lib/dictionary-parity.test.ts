import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

/**
 * en.json and es.json must stay structurally identical — every leaf key present
 * in one locale must exist in the other. The dictionary type is derived from one
 * locale, so a key removed from just one file (as happened when the T-109
 * photo-approval keys were stripped from en.json only) compiles against the
 * other locale but breaks `dict.<key>` reads at the type level and leaves the
 * app referencing keys that don't exist. This guard fails the moment the two
 * files drift.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function leafKeyPaths(value: Json, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.keys(value).flatMap((key) =>
    leafKeyPaths((value as { [k: string]: Json })[key], prefix ? `${prefix}.${key}` : key),
  );
}

describe('dictionary parity (en ↔ es)', () => {
  const enPaths = new Set(leafKeyPaths(en as Json));
  const esPaths = new Set(leafKeyPaths(es as Json));

  it('has no keys present in en.json but missing from es.json', () => {
    const missingInEs = [...enPaths].filter((p) => !esPaths.has(p)).sort();
    expect(missingInEs).toEqual([]);
  });

  it('has no keys present in es.json but missing from en.json', () => {
    const missingInEn = [...esPaths].filter((p) => !enPaths.has(p)).sort();
    expect(missingInEn).toEqual([]);
  });
});
