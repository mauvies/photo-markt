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
      // Target floor — NOT enforced yet. The thresholds block is omitted on
      // purpose so coverage is reported but the build doesn't fail. Once we
      // have enough tests to clear 60%, add:
      //   thresholds: { lines: 60, branches: 60, functions: 60, statements: 60 }
    },
  },
});
