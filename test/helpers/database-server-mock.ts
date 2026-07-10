import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * Build the standard `@/database/server` mock for Server Action / layout
 * integration tests. `createClient` returns a service-role client whose
 * `auth.getUser()` is driven by the shared `mockSession`, and `getUser`
 * mirrors the cached helper added in T-095 by resolving the user through the
 * same stubbed auth call.
 *
 * Vitest only hoists the `vi.mock` call itself, so this builder is invoked from
 * *inside* a hoisted factory via dynamic import (the same pattern already used
 * to pull in `@supabase/supabase-js`):
 *
 *   vi.mock('@/database/server', async () => {
 *     const { buildDatabaseServerMock } = await import('../../helpers/database-server-mock');
 *     const { mockSession } = await import('../../helpers/server-action-mocks');
 *     return buildDatabaseServerMock(mockSession);
 *   });
 *
 * `mockSession.userId` is read lazily on each `getUser()` call, so tests can
 * flip the signed-in user between assertions without rebuilding the mock.
 */
export function buildDatabaseServerMock(mockSession: { userId: string | null }) {
  const makeClient = () => {
    const sb = createSupabaseClient(LOCAL_URL, LOCAL_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    sb.auth.getUser = vi.fn(async () => {
      if (!mockSession.userId) {
        return { data: { user: null }, error: null } as never;
      }
      return {
        data: {
          user: { id: mockSession.userId, email: `${mockSession.userId}@photomarkt.test` },
        },
        error: null,
      } as never;
    });
    return sb;
  };
  return {
    createClient: vi.fn(async () => makeClient()),
    getUser: vi.fn(async () => {
      const { data } = await makeClient().auth.getUser();
      return data.user;
    }),
  };
}
