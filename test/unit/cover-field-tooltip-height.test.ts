import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-149: on the wizard's cover-image field
 * (`/dashboard/photographer/events/new?step=3`), the `coverDesc` copy moved
 * from a `<p>` under the label into a tooltip opened from an info icon next
 * to the label, and the selector box switched from a fixed `aspect-video`
 * ratio to full-height on desktop / a compact fixed height on mobile.
 *
 * Source-level assertions (matching the T-127/T-128/T-158 pattern) fail
 * before the change and pass after.
 */

const root = process.cwd();

function readSource(): string {
  return readFileSync(
    resolve(root, 'src/app/[lang]/dashboard/photographer/events/new/steps/step-3-details.tsx'),
    'utf8',
  );
}

describe('cover field tooltip + height (T-149)', () => {
  it('no longer renders coverDesc as a <p> under the label', () => {
    const source = readSource();
    expect(source).not.toContain(
      '<p className="text-xs text-muted-foreground">{t(\'coverDesc\')}</p>',
    );
  });

  it('renders coverDesc inside a Tooltip with an accessible info trigger', () => {
    const source = readSource();
    expect(source).toContain(
      "import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';",
    );
    expect(source).toContain('<TooltipTrigger');
    expect(source).toContain("aria-label={t('coverInfoAria')}");
    expect(source).toContain('<TooltipContent>');
    // coverDesc copy is reused verbatim as the tooltip content, not rewritten.
    expect(source).toContain("{t('coverDesc')}");
  });

  it('drops the fixed aspect-video ratio in favor of responsive heights', () => {
    const source = readSource();
    expect(source).not.toContain('aspect-video');
  });

  it('stretches the cover box to full height on desktop (md:)', () => {
    const source = readSource();
    expect(source).toContain('md:items-stretch');
    expect(source).toContain('md:h-full');
    expect(source).toContain('md:flex-1');
  });

  it('keeps a compact fixed height on mobile', () => {
    const source = readSource();
    // Both the preview and empty-state boxes carry the same mobile height class.
    const mobileHeightMatches = source.match(/\bh-40\b/g) ?? [];
    expect(mobileHeightMatches.length).toBeGreaterThanOrEqual(2);
  });
});
