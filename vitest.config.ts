import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Native tsconfig path resolution (Vitest 4 / Vite 7) — resolves `@/*` from
  // tsconfig.json so test files import the same way app code does.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Default env for unit + integration tests. Component tests will need
    // `jsdom` — we'll add a separate config or per-file override when those
    // arrive (see `// @vitest-environment jsdom`).
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts'],
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
      include: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'database/queries/**/*.ts'],
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
