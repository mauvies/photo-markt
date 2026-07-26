import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-181: Bricolage Grotesque replaces Inter Tight for
 * headings, wired in exactly two places (layout.tsx loads it as a CSS var,
 * globals.css maps the --font-heading token + the h1..h6 / .font-heading
 * declarations to it) and — critically (T-123) — as a *replacement*, keeping
 * the render-critical webfont-preload count at exactly two families.
 *
 * Source-level assertions (cover-field-tooltip-height / route-loading-skeletons
 * pattern): fail before the fix, pass after.
 */

const root = process.cwd();
const layout = readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8');
const globals = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');

describe('Bricolage Grotesque font wiring (T-181)', () => {
  it('layout.tsx loads Bricolage Grotesque and exposes it as --font-bricolage', () => {
    expect(layout).toContain('Bricolage_Grotesque');
    expect(layout).toContain("variable: '--font-bricolage'");
    // Its CSS var must reach the <html> className alongside Inter.
    expect(layout).toContain('bricolage.variable');
  });

  it('globals.css maps the --font-heading token and headings to Bricolage', () => {
    expect(globals).toContain('--font-heading: var(--font-bricolage)');
    // Headings (h1..h6) and the .font-heading utility resolve to Bricolage,
    // then fall back to Inter and the system stack for FOUT/no-webfont.
    expect(globals).toContain(
      'font-family: var(--font-bricolage), var(--font-inter), ui-sans-serif, system-ui, sans-serif',
    );
  });

  it('replaces Inter Tight rather than adding a third webfont (net-zero preloads, T-123)', () => {
    expect(layout).not.toContain('Inter_Tight');
    expect(layout).not.toContain('--font-inter-tight');
    expect(globals).not.toContain('--font-inter-tight');
    // Exactly two next/font families remain (Inter + Bricolage) — no third
    // render-critical preload sneaks in.
    const families = layout.match(/^const \w+ = \w+\(\{/gm) ?? [];
    expect(families).toHaveLength(2);
  });
});
