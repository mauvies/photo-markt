import { describe, expect, it } from 'vitest';
import { computeTrendPct } from '@/database/queries/sales';

describe('computeTrendPct', () => {
  it('returns null when the previous period had zero activity', () => {
    expect(computeTrendPct(100, 0)).toBeNull();
    expect(computeTrendPct(0, 0)).toBeNull();
  });

  it('returns 0 when current equals previous', () => {
    expect(computeTrendPct(100, 100)).toBe(0);
    expect(computeTrendPct(0, 50)).toBe(-100);
  });

  it('returns +100 when current doubles previous', () => {
    expect(computeTrendPct(200, 100)).toBe(100);
  });

  it('returns negative pct when current shrinks vs previous', () => {
    expect(computeTrendPct(50, 100)).toBe(-50);
  });

  it('handles fractional deltas', () => {
    expect(computeTrendPct(150, 100)).toBe(50);
    expect(computeTrendPct(125, 100)).toBe(25);
  });
});
