import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Unit-only coverage gate (T-222) — what the Docker-free `test` workflow runs
 * on every PR.
 *
 * Why a SECOND floor exists instead of one number: the per-PR gate cannot boot
 * Postgres, so it can only run `test/unit`, and unit-only coverage is ~20%
 * against the same instrumented file set — not because the project is 20%
 * tested, but because `src/database/queries/**`, the Stripe webhook and the
 * Inngest workers are deliberately covered by integration tests. The full
 * number (54% lines) lives in `vitest.config.ts` and is enforced by
 * `pnpm test:coverage`; no CI job runs the whole suite in one process
 * (`test.yml` runs unit, `test-integration.yml` runs `test/integration`), so
 * that one is a local gate by construction.
 *
 * A floor this low still earns its place: it is the only coverage check that
 * can BLOCK a PR, and a cliff — a deleted suite, a skipped describe — is
 * exactly what it catches. It is not evidence about the project's coverage,
 * and it must never be quoted as such.
 *
 * Measured 2026-09-07 over `test/unit` (1509 tests):
 *   lines 20.23 · branches 20.59 · functions 22.82 · statements 20.70
 * Floors are those minus ~2, same ratchet rule as the full suite.
 *
 * ⚠️ Only `coverage.thresholds` is overridden. The test `include` stays the
 * base one and the unit scope comes from the CLI path filter in
 * `test:coverage:unit` — `mergeConfig` CONCATENATES arrays, so overriding
 * `include` here would union the two globs and silently pull the integration
 * suite back in.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: { lines: 18, branches: 18, functions: 20, statements: 18 },
      },
    },
  }),
);
