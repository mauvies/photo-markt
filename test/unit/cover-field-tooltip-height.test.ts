import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-149 (cover-image field: coverDesc moved into a tooltip
 * opened from an info icon; the box switched from `aspect-video` to responsive
 * heights) — the behavior now lives in the shared `EventCoverField` component
 * after T-166 extracted the block so the create wizard and the edit form share
 * one implementation. These source-level assertions (T-127/T-128/T-158 pattern)
 * pin that behavior on the component and its two call sites.
 */

const root = process.cwd();

function readComponent(): string {
  return readFileSync(resolve(root, 'src/components/event-cover-field.tsx'), 'utf8');
}

function readCreateStep(): string {
  return readFileSync(
    resolve(root, 'src/app/[lang]/dashboard/photographer/events/new/steps/step-3-details.tsx'),
    'utf8',
  );
}

describe('EventCoverField — tooltip + responsive height (T-149 / T-166)', () => {
  it('renders the description inside a Tooltip with an accessible info trigger', () => {
    const source = readComponent();
    expect(source).toContain(
      "import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';",
    );
    expect(source).toContain('<TooltipTrigger');
    expect(source).toContain('aria-label={labels.infoAria}');
    expect(source).toContain('<TooltipContent>');
    expect(source).toContain('{labels.desc}');
  });

  it('does not use a fixed aspect-video ratio', () => {
    expect(readComponent()).not.toContain('aspect-video');
  });

  it('keeps a compact fixed height and stretches only when fill is set', () => {
    const source = readComponent();
    expect(source).toContain('h-40');
    // The stretch classes are gated behind the `fill` flag (create wizard only).
    expect(source).toContain('md:h-full');
    expect(source).toContain('md:flex-1');
  });

  it('the create wizard delegates to the shared EventCoverField with fill', () => {
    const source = readCreateStep();
    expect(source).toContain("import { EventCoverField } from '@/components/event-cover-field';");
    expect(source).toContain('<EventCoverField');
    expect(source).toContain('fill');
    // coverDesc/coverInfoAria copy is reused verbatim, not rewritten.
    expect(source).toContain("desc: t('coverDesc')");
    expect(source).toContain("infoAria: t('coverInfoAria')");
    // The wizard's two-column stretch container is unchanged.
    expect(source).toContain('md:items-stretch');
  });
});
