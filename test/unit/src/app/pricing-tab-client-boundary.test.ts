import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for a runtime-only failure found while reviewing T-203, re-stated as the
 * real rule in T-213.
 *
 * `EventPricingTab` shipped without `'use client'` and CALLED `buttonVariants()`
 * imported from `@/components/ui/button` — a `'use client'` module. A Server
 * Component may render a client component but cannot invoke a client function,
 * so the tab threw on render:
 *
 *   "Attempted to call buttonVariants() from the server but buttonVariants is
 *    on the client."
 *
 * Neither `pnpm build` nor the test suite caught it: the module compiles fine
 * either way, and nothing rendered that tab. Hence a source-level guard.
 *
 * ⚠️ The rule this originally pinned was wrong. It asserted "a component that
 * calls `buttonVariants` must declare `'use client'`", which fixes the crash by
 * pushing an inert read-only table into the browser bundle — and, worse, makes
 * the workaround the standard. `@/components/ui/button-variants` is a plain
 * module with no directive, exported for exactly this case
 * (`photographer-public-profile.tsx` has always used it). So the real rule, and
 * what this file now enforces repo-wide, is:
 *
 *   importing `buttonVariants` from `@/components/ui/button` requires
 *   `'use client'`; a Server Component imports it from
 *   `@/components/ui/button-variants` instead.
 *
 * Stated that way it holds for every file rather than a hand-maintained list,
 * and both escapes from the crash — add the directive, or move the import —
 * satisfy it, which is correct: the crash is what must not ship, not one
 * particular remedy for it.
 */

const REPO_ROOT = join(import.meta.dirname, '../../../..');
const SRC = join(REPO_ROOT, 'src');

/** The `'use client'` module. Importing `buttonVariants` from here is the risk. */
const CLIENT_MODULE = /from ['"]@\/components\/ui\/button['"]/;
/** The directive-free twin a Server Component may call. */
const SERVER_SAFE_MODULE = '@/components/ui/button-variants';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** True when `'use client'` is the module's first statement (before any import). */
function declaresUseClient(source: string): boolean {
  const firstCode = source
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'),
    );
  return firstCode === "'use client';" || firstCode === '"use client";';
}

/** Files that import `buttonVariants`, excluding the two modules that define it. */
function buttonVariantsImporters(): Array<{ path: string; source: string }> {
  return walk(SRC)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ path, source }) => {
      const rel = path.slice(REPO_ROOT.length + 1);
      if (
        rel === 'src/components/ui/button.tsx' ||
        rel === 'src/components/ui/button-variants.ts'
      ) {
        return false;
      }
      return /import[\s\S]*?\bbuttonVariants\b[\s\S]*?from/.test(source);
    })
    .map(({ path, source }) => ({ path: path.slice(REPO_ROOT.length + 1), source }));
}

describe('buttonVariants callers stay on the right side of the client boundary', () => {
  const importers = buttonVariantsImporters();

  it('finds the callers to check (a zero-length sweep would pass vacuously)', () => {
    expect(importers.length).toBeGreaterThan(5);
  });

  for (const { path, source } of importers) {
    it(`${path} either is a client component or imports from button-variants`, () => {
      if (source.includes(SERVER_SAFE_MODULE)) {
        // Server-safe import: valid from a Server Component AND from a client one.
        expect(source).toContain(SERVER_SAFE_MODULE);
        return;
      }
      // Pulled from the `'use client'` module — only legal inside one.
      expect(CLIENT_MODULE.test(source)).toBe(true);
      expect(declaresUseClient(source)).toBe(true);
    });
  }
});

describe('EventPricingTab is a Server Component', () => {
  const path = 'src/app/[lang]/dashboard/photographer/events/[id]/event-pricing-tab.tsx';
  const source = readFileSync(join(REPO_ROOT, path), 'utf8');

  it('imports buttonVariants from the directive-free module', () => {
    expect(source).toContain(`from '${SERVER_SAFE_MODULE}'`);
  });

  it("does not declare 'use client'", () => {
    // A read-only pricing table has no state, no handlers and no browser APIs;
    // the directive existed only to work around the import above.
    expect(declaresUseClient(source)).toBe(false);
  });
});
