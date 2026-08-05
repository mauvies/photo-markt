/**
 * The integration suite's trigger set is a safety property, so it gets a test
 * (T-217).
 *
 * THE GAP THIS PINS: until now `test-integration.yml` ran only nightly and on
 * demand. A PR merged without a green local run broke main and nobody found out
 * until the next morning — a window of up to 24 hours over the 83 files that
 * cover the Stripe webhook, RLS, the Inngest workers, bundle checkout, the
 * reveal gate and the SECURITY DEFINER inventory. Running on merge to main
 * closes it to minutes.
 *
 * Deleting the `push` trigger to save Actions minutes is a plausible future
 * edit, and it would silently restore the 24-hour window; that is exactly the
 * kind of change that should have to argue with a red test first.
 *
 * The assertions are deliberately made against the `on:` block alone, parsed by
 * hand: adding a YAML dependency to the app to read one CI file is not worth it,
 * and a whole-file substring match would go green on a `push:` that appears in a
 * comment or in a different key.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = '.github/workflows/test-integration.yml';

/**
 * The `on:` block, stripped of comments — from `on:` to the next top-level key.
 * Indentation is the only structure this needs, so it does not need YAML.
 */
function readTriggerBlock(): string {
  const lines = readFileSync(resolve(process.cwd(), WORKFLOW), 'utf8').split('\n');

  const start = lines.findIndex((line) => line.startsWith('on:'));
  expect(start, `no top-level "on:" key in ${WORKFLOW}`).toBeGreaterThan(-1);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[a-z]/.test(line));

  return (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

describe('test-integration.yml triggers', () => {
  const triggers = readTriggerBlock();

  it('runs on every merge to main — no regression sits undetected until morning', () => {
    expect(triggers).toMatch(/\bpush:/);
    // Under `push:`, and pointing at main. An unfiltered branch list is the
    // point: a `paths` allowlist here would skip test/integration/actions/,
    // whose subjects live under src/app/[lang]/**.
    expect(triggers).toMatch(/push:\s*\n\s+branches:\s*\n\s+-\s*main\b/);
  });

  it('does not filter the merge run by paths', () => {
    const push = triggers.slice(triggers.indexOf('push:'));
    const nextTrigger = push.slice(1).search(/\n {2}\w+:/);
    const pushBlock = nextTrigger === -1 ? push : push.slice(0, nextTrigger + 1);

    expect(pushBlock).not.toMatch(/paths/);
  });

  it('keeps the nightly run as the flake net', () => {
    expect(triggers).toMatch(/schedule:/);
    expect(triggers).toMatch(/cron:\s*'17 4 \* \* \*'/);
  });

  it('stays runnable on demand against a branch before a risky merge', () => {
    expect(triggers).toMatch(/workflow_dispatch:/);
  });
});
