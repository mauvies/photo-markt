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
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'database/queries/**/*.ts',
        'components/photo-gallery/**/*.{ts,tsx}',
        'components/lightbox-action-bar.tsx',
        'hooks/use-long-press.ts',
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
        'app/**/page.tsx',
        'app/**/layout.tsx',
        // Re-exports
        'database/queries/index.ts',
      ],
      // Target floor — NOT enforced yet. The thresholds block is omitted on
      // purpose so coverage is reported but the build doesn't fail. Once we
      // have enough tests to clear 60%, add:
      //   thresholds: { lines: 60, branches: 60, functions: 60, statements: 60 }
    },
  },
});
