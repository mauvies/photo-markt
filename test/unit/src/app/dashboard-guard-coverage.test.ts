/**
 * Companion to `dashboard-auth-guard.test.ts` (T-198).
 *
 * Those tests drive three route modules for real. The remaining dashboard
 * segments that crash when rendered without a session pull in the whole
 * dashboard component tree, so they're pinned here at the source level instead:
 * each must call the shared `requireUser()` guard.
 *
 * Why a guard is needed in *every* one of them: Next renders a route's segments
 * in parallel, so the login redirect in `dashboard/layout.tsx` does not stop a
 * child from executing. A child that throws on a missing session (all of these
 * reach a query or action that does) races that redirect into the error
 * boundary — the intermittent error screen T-198 reported.
 *
 * Adding a dashboard page that reads auth-dependent data? Add the guard, and
 * add the file here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** Dashboard segments whose data reads throw without a session. */
const GUARDED_SEGMENTS = [
  'src/app/[lang]/dashboard/layout.tsx',
  'src/app/[lang]/dashboard/page.tsx',
  'src/app/[lang]/dashboard/talent/layout.tsx',
  'src/app/[lang]/dashboard/talent/orders/page.tsx',
  'src/app/[lang]/dashboard/talent/profile/page.tsx',
  'src/app/[lang]/dashboard/photographer/layout.tsx',
  'src/app/[lang]/dashboard/photographer/page.tsx',
];

describe('dashboard segments guard the session', () => {
  for (const file of GUARDED_SEGMENTS) {
    it(`${file} calls requireUser()`, () => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      expect(source).toContain("from '@/lib/auth/require-user'");
      expect(source).toMatch(/\brequireUser\(\)/);
    });
  }
});
