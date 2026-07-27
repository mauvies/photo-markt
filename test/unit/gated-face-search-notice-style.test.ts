import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-186: the reveal-gate dead-end notice
 * (`GatedFaceSearchNotice`, T-184) must use the same visual hierarchy as the
 * cart empty-state (`/cart`) — large centered icon, large title, muted
 * description — instead of the previous dashed-border box. Both states
 * (processing/unavailable) and both surfaces (public + talent dashboard) inherit
 * it from this single component. Fails before the restyle, passes after.
 */

const source = readFileSync(
  resolve(process.cwd(), 'src/components/gated-face-search-notice.tsx'),
  'utf8',
);

describe('GatedFaceSearchNotice cart empty-state styling (T-186)', () => {
  it('drops the dashed-border box styling', () => {
    expect(source).not.toContain('border-dashed');
    expect(source).not.toContain('bg-muted/30');
  });

  it('uses the cart empty-state container/typography classes', () => {
    expect(source).toContain('flex flex-col items-center justify-center py-16 px-4 text-center');
    expect(source).toContain('h-16 w-16 text-muted-foreground/50');
    expect(source).toContain('<h3 className="text-2xl font-semibold mb-2">');
    expect(source).toContain('text-sm text-muted-foreground mb-6 max-w-md');
  });
});
