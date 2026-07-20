import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for T-167: on the event edit form, the "Price per Photo"
 * field showed the `$` prefix floating below the number. Two causes:
 *  (A) Row 3 (`Date + Price`) was a `grid ... md:grid-cols-2` WITHOUT
 *      `items-start`, so the Price cell stretched to match the taller Date
 *      column (Date + Session time), growing the price field's `.relative` box
 *      until the `top-1/2`-centered `$` sat a line below the value; and
 *  (B) the edit input lacked the `text-sm` the create wizard's input has, so
 *      the `$` and the value didn't share a line-height.
 *
 * Source-level assertions (cover-field-tooltip-height / route-loading-skeletons
 * pattern): fail before the fix, pass after.
 */

const root = process.cwd();

const editSource = readFileSync(
  resolve(
    root,
    'src/app/[lang]/dashboard/photographer/events/[id]/edit/components/event-form-fields.tsx',
  ),
  'utf8',
);

describe('edit event price field layout (T-167)', () => {
  it('Row 3 (Date + Price) uses items-start so the Price cell does not stretch', () => {
    // The stretched grid was the large-offset cause; anchor the cells to the
    // top. Row 1 (Name + Activity) is symmetric and legitimately keeps the plain
    // `grid gap-4 md:grid-cols-2`, so we assert only the presence of the
    // items-start row (unique to Row 3 after the fix) — absent before it.
    expect(editSource).toContain('grid items-start gap-4 md:grid-cols-2');
  });

  it('the price input carries text-sm for line-height parity with the create wizard', () => {
    expect(editSource).toContain('className="pl-7 text-sm"');
    // The bare `pl-7` (no text-sm) must no longer be used on the price input.
    expect(editSource).not.toContain('className="pl-7"');
  });
});
