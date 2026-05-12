/**
 * Example integration test — hits a real local Supabase instance.
 *
 * Pattern for future integration tests:
 *   1. `beforeEach(() => resetDatabase())` — every test starts from zero so
 *      ordering between tests can't accidentally pass or fail one.
 *   2. Use the `createTest*` helpers to set up known fixtures. They use the
 *      service-role client and bypass RLS, which is what setup should do.
 *   3. Exercise the real query function from `database/queries/` against a
 *      real client. Choose the client deliberately:
 *        - service-role client → "the query works correctly given the data"
 *        - anon / user-scoped client → "the query plus RLS does the right thing"
 *
 *   When a test must fail if Supabase local isn't running (the acceptance
 *   criterion for this PR), let the underlying fetch error propagate.
 *   Vitest will surface a connection-refused error with enough context.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getEventBySlug } from '@/database/queries/events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../helpers/supabase-test-client';

describe('database/queries/events :: getEventBySlug', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns the event when slug matches a public, non-deleted event', async () => {
    const sb = createServiceClient();
    const user = await createTestUser('PHOTOGRAPHER', undefined, sb);
    const event = await createTestEvent(
      user.id,
      { slug: 'photo-day-barcelona-2026', is_public: true },
      sb,
    );

    // Use a fresh client for the read — same shape as how server code calls it.
    const found = await getEventBySlug(createServiceClient(), 'photo-day-barcelona-2026');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(event.id);
    expect(found?.slug).toBe('photo-day-barcelona-2026');
  });

  it('returns null when no event matches the slug', async () => {
    const sb = createServiceClient();
    const user = await createTestUser('PHOTOGRAPHER', undefined, sb);
    await createTestEvent(user.id, { slug: 'something-else-2026', is_public: true }, sb);

    const found = await getEventBySlug(createServiceClient(), 'does-not-exist');
    expect(found).toBeNull();
  });

  it('returns null when the matching event is private (is_public=false)', async () => {
    const sb = createServiceClient();
    const user = await createTestUser('PHOTOGRAPHER', undefined, sb);
    await createTestEvent(user.id, { slug: 'private-event-2026', is_public: false }, sb);

    // getEventBySlug filters by `is_public = true` — private events are
    // intentionally not returned by this query.
    const found = await getEventBySlug(createServiceClient(), 'private-event-2026');
    expect(found).toBeNull();
  });
});
