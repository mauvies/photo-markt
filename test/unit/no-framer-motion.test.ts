import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with the repo root as cwd.
const root = process.cwd();

/**
 * Regression guard for T-135: `framer-motion` was removed (only `feedback-view.tsx`
 * used it) and its animations reimplemented in CSS. This test fails before the fix
 * (feedback-view imported the lib) and passes after — and keeps the dependency from
 * silently creeping back in.
 *
 * The EventSearchBar keeps a *comment* mentioning framer-motion, so we match the
 * actual import forms, not the bare string.
 */

const IMPORT_PATTERNS = [
  /from\s+['"]framer-motion['"]/,
  /require\(\s*['"]framer-motion['"]\s*\)/,
  /import\(\s*['"]framer-motion['"]\s*\)/,
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

describe('framer-motion removal (T-135)', () => {
  it('has no framer-motion import anywhere under src/', () => {
    const offenders = collectSourceFiles(resolve(root, 'src')).filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return IMPORT_PATTERNS.some((pattern) => pattern.test(contents));
    });

    expect(offenders).toEqual([]);
  });

  it('is not listed in package.json dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies ?? {}).not.toHaveProperty('framer-motion');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('framer-motion');
  });
});
