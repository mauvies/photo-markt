import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseConfig from '../../../vitest.config';
import unitConfig from '../../../vitest.unit.config';

/**
 * T-222: the coverage ratchet exists in two halves that can only fail together
 * by accident, so both are pinned here.
 *
 * Before this ticket the repo had the worst of both worlds — a declared 60%
 * target nobody measured and a `thresholds` block commented out "until we have
 * enough tests". The real number turned out to be 54% lines, six points from
 * the aspiration. What keeps that from rotting again is not the numbers below
 * but the wiring: a gate that can be switched off by deleting one YAML line is
 * a gate that eventually is.
 */

type Thresholds = { lines: number; branches: number; functions: number; statements: number };

function thresholdsOf(config: unknown): Thresholds {
  const t = (config as { test?: { coverage?: { thresholds?: Thresholds } } }).test?.coverage
    ?.thresholds;
  if (!t) throw new Error('no coverage.thresholds on this config');
  return t;
}

const METRICS = ['lines', 'branches', 'functions', 'statements'] as const;
const workflow = readFileSync(join(process.cwd(), '.github/workflows/test.yml'), 'utf8');

describe('coverage gate (T-222)', () => {
  it('enforces a full-suite floor — thresholds are no longer commented out', () => {
    const base = thresholdsOf(baseConfig);
    for (const metric of METRICS) {
      expect(base[metric], `${metric} floor must be a real number, not 0/absent`).toBeGreaterThan(
        0,
      );
    }
  });

  it('gives the unit run its own, lower floor', () => {
    const base = thresholdsOf(baseConfig);
    const unit = thresholdsOf(unitConfig);
    for (const metric of METRICS) {
      // The unit run measures ~20% against the same instrumented files (the
      // queries layer, the webhook and the Inngest workers are integration-
      // tested), so inheriting the full floor would fail every single PR.
      // This also proves `mergeConfig` actually applied the override.
      expect(unit[metric], `unit ${metric} floor must sit below the full-suite floor`).toBeLessThan(
        base[metric],
      );
      expect(unit[metric]).toBeGreaterThan(0);
    }
  });

  it('keeps the base config as the single source of the shared coverage settings', () => {
    // ⚠️ `mergeConfig` CONCATENATES arrays. If the unit config ever overrides
    // `include`, the two globs union and the integration suite silently comes
    // back into a "unit" run — which would then need Postgres in the
    // Docker-free workflow. The unit scope must stay a CLI path filter.
    const baseInclude = (baseConfig as { test?: { include?: string[] } }).test?.include;
    const unitInclude = (unitConfig as { test?: { include?: string[] } }).test?.include;
    expect(unitInclude).toEqual(baseInclude);
  });

  it('wires the gate into the Docker-free workflow that runs on every PR', () => {
    expect(workflow, 'the `test` workflow must run the coverage-enforcing script').toContain(
      'pnpm test:coverage:unit',
    );
    // Reverting to the plain script would keep CI green while silently
    // removing the only coverage check that can block a PR.
    expect(workflow, 'plain `pnpm test:unit` in CI means the ratchet is off').not.toMatch(
      /run:\s*pnpm test:unit\s*$/m,
    );
  });

  it('never versions the report — a committed coverage/ is stale by construction', () => {
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\/coverage$/m);
  });
});
