import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-234 regression: `src/app/auth/role/route.ts` was a live `POST` endpoint
 * that mutated the caller's role by delegating to the `switchRole` Server
 * Action — with **zero callers** anywhere in the app. Same shape as the dead
 * billing routes T-202 removed: an unreviewed second way into a mutation whose
 * real surface is a Server Action, and one more thing to keep in sync (it would
 * have needed rewriting for the typed `RoleActionResult` this ticket
 * introduced).
 *
 * CLAUDE.md is explicit that mutations go through Server Actions, not API
 * routes. Source-level on purpose: what must not come back is the FILE — Next's
 * app-router file convention is what makes the endpoint exist at all.
 */

const ROLE_ROUTE = join(process.cwd(), 'src/app/auth/role/route.ts');
const ROLE_ACTIONS = join(process.cwd(), 'src/app/[lang]/actions/roles.ts');

describe('dead auth/role API route (T-234)', () => {
  it('exposes no route handler at src/app/auth/role/', () => {
    expect(
      existsSync(ROLE_ROUTE),
      'role mutations go through the Server Actions in src/app/[lang]/actions/roles.ts — ' +
        'a route handler here is a second, unreviewed way to change a user role',
    ).toBe(false);
  });

  it('keeps the Server Actions that own role mutation', () => {
    // Guards the deletion from being widened: the route is removable precisely
    // BECAUSE this module owns the live flow. Without this, the assertion above
    // would still pass if role switching lost its only surface entirely.
    expect(existsSync(ROLE_ACTIONS), 'the role Server Actions must exist').toBe(true);

    const source = readFileSync(ROLE_ACTIONS, 'utf8');
    expect(source).toContain('export async function switchRole');
    expect(source).toContain('export async function enablePhotographerRole');
    expect(source).toContain('export async function enableTalentRole');
  });
});
