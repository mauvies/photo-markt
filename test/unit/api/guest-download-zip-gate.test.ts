/**
 * The guest ZIP route's gate (T-245).
 *
 * `/api/download/[token]` has no session to authenticate — the buyer never had
 * an account — so **the token is the credential**. That makes three properties
 * load-bearing, and all three are one edit away from quietly disappearing:
 *
 *   1. An expired token is refused. Otherwise the expiry the page advertises is
 *      decorative and every link ever issued stays live forever.
 *   2. The photo set comes from the ORDER's own items, never from anything in
 *      the request, so no id can widen it.
 *   3. The photo read carries no `deleted_at` filter — a sold photo is
 *      soft-deleted so the buyer keeps it (T-142), and filtering here would take
 *      a paid-for photo away as soon as the photographer tidied their event.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const ROUTE = 'src/app/api/download/[token]/route.ts';

describe('guest ZIP download gate', () => {
  const source = readFileSync(join(REPO_ROOT, ROUTE), 'utf8');

  it('refuses an expired token', () => {
    expect(source).toContain('new Date(downloadToken.expires_at) < new Date()');
  });

  it('only serves a completed order', () => {
    expect(source).toContain("guestOrder?.status !== 'completed'");
  });

  it('takes the photo set from the order, never from the request', () => {
    expect(source).toContain('guestOrder.items.slice(0, MAX_PHOTOS).map((item) => item.photo_id)');
    // The only request input is the token itself.
    expect(source).not.toContain('searchParams');
    expect(source).not.toContain('request.json()');
  });

  it('does not filter soft-deleted photos out of a purchase', () => {
    // The QUERY, not the prose — the docstring names the column to explain why
    // the filter is absent.
    expect(source).not.toMatch(/\.is\(\s*'deleted_at'/);
    expect(source).not.toMatch(/\.eq\(\s*'deleted_at'/);
  });

  it('is rate limited', () => {
    expect(source).toContain('rateLimit({');
  });
});
