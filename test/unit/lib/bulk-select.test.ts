import { describe, expect, it } from 'vitest';
import { filterNewIds } from '@/lib/bulk-select';

describe('filterNewIds (T-042)', () => {
  it('drops ids already present in the exclude set (the bulk-favorite bug)', () => {
    // Re-favoriting the same 3 photos must report 0 new, not 3.
    expect(filterNewIds(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it('keeps only the ids not yet present', () => {
    expect(filterNewIds(['a', 'b', 'c'], new Set(['a']))).toEqual(['b', 'c']);
  });

  it('keeps everything when nothing is excluded', () => {
    expect(filterNewIds(['a', 'b'], new Set())).toEqual(['a', 'b']);
  });

  it('excludes ids present in any of several sets (cart: in-cart OR purchased)', () => {
    expect(filterNewIds(['a', 'b', 'c'], new Set(['a']), new Set(['c']))).toEqual(['b']);
  });

  it('preserves selection order and returns [] for an empty selection', () => {
    expect(filterNewIds(['c', 'a', 'b'], new Set(['a']))).toEqual(['c', 'b']);
    expect(filterNewIds([], new Set(['a']))).toEqual([]);
  });
});
