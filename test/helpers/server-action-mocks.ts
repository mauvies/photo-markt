/**
 * Shared state for Server Action tests.
 *
 * **The `vi.mock` declarations themselves must live INLINE in each test
 * file** — Vitest only hoists `vi.mock` calls at the top level of a test
 * file, so calls from imported helper functions run after the module's
 * top-level imports and fail to intercept anything.
 *
 * This module exports only the shared *state* the inline mocks read.
 * The canonical mock block lives at the top of each test file (see
 * `test/integration/actions/cart.test.ts` for the reference).
 *
 * When the test file is for `app/[lang]/actions/roles.ts` itself, drop
 * the `getActiveRole` mock from the inline block — it would shadow the
 * exports under test.
 */

export type MockRole = 'talent' | 'photographer';

export const mockSession: {
  userId: string | null;
  activeRole: MockRole;
} = {
  userId: null,
  activeRole: 'talent',
};
