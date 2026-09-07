import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Native tsconfig path resolution (Vitest 4 / Vite 7) — resolves `@/*` from
  // tsconfig.json so test files import the same way app code does.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Default env for unit + integration tests. Component tests opt into a DOM
    // per file via the `@vitest-environment happy-dom` docblock.
    environment: 'node',
    globals: false,
    // App code logs on its error/fail-closed branches, which integration
    // tests deliberately exercise — expected noise, not failures. Silence
    // console from passing tests; keep it for failing ones so a real failure
    // still shows its logs.
    silent: 'passed-only',
    // Populate env-var defaults before any test file imports `env.mjs` — see
    // test/setup.ts for the rationale.
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'coverage', 'dist'],
    // Integration tests reset the DB between runs; without single-fork
    // execution they'd race against each other on the shared local Supabase
    // instance. Unit-only runs aren't slowed meaningfully by this.
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Files measured for coverage. Exclude obvious noise so the percentage
      // reflects code that's worth testing.
      include: [
        'src/app/**/*.{ts,tsx}',
        'src/lib/**/*.{ts,tsx}',
        'src/database/queries/**/*.ts',
        'src/components/photo-gallery/**/*.{ts,tsx}',
        'src/components/lightbox-action-bar.tsx',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/__tests__/**',
        'test/**',
        // Generated and config-like files
        '**/loading.tsx',
        '**/not-found.tsx',
        '**/error.tsx',
        'src/app/**/page.tsx',
        'src/app/**/layout.tsx',
        // Re-exports
        'src/database/queries/index.ts',
      ],
      // RATCHET, not a quality claim (T-222). Set at the measured floor minus
      // ~2 points: ordinary growth (a new module landing before its tests)
      // stays under the buffer, a cliff (a deleted suite, a `describe.skip`
      // left in) trips it. Raising these is the job of the PR that lifts the
      // real number — that is the whole mechanism.
      //
      // Measured 2026-09-07 over the FULL suite (2484 tests, Supabase up):
      //   lines 54.25 · branches 48.35 · functions 52.41 · statements 53.58
      // The 60% aspiration this block used to defer to is ~6 points away on
      // lines; it stopped being a reason to enforce nothing.
      //
      // ⚠️ Thresholds apply to whatever run invokes `--coverage`, and only the
      // full suite can clear these — `src/database/queries/**`, the Stripe
      // webhook and the Inngest workers are covered by integration tests that
      // need Postgres, so a unit-only run measures ~20% and would fail here.
      // These belong to `pnpm test:coverage`. The Docker-free PR gate carries
      // its own, much lower floor in `vitest.unit.config.ts`.
      thresholds: { lines: 52, branches: 46, functions: 50, statements: 51 },
    },
  },
});
