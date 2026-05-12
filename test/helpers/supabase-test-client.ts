import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ROLES, type UserRole } from '@/lib/roles';

/**
 * Stable default credentials shipped by the Supabase CLI for the local
 * development stack. These are *not* secrets; they're identical across every
 * `supabase start` and are documented at
 * https://supabase.com/docs/guides/cli/local-development. Hardcoding them
 * keeps tests reproducible without forcing every contributor to populate
 * a `.env.test` file.
 */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
export const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Service-role client for test setup/teardown. Bypasses RLS — only used by
 * the helpers in this file. Production code never imports from `test/`.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Anonymous client — useful when a test wants to verify RLS from the
 * perspective of an unauthenticated request.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Wipe every user-data table between tests so each one starts from a known
 * state. Order matters when there are no `ON DELETE CASCADE` chains we can
 * rely on — auth.users cascades to profiles/photos/etc., so deleting users
 * is the fast path. We also TRUNCATE public tables that aren't tied to a
 * user (e.g. rate_limit_buckets) for completeness.
 *
 * Cheaper than `supabase db reset` (which re-runs every migration) and
 * sufficient for between-test isolation.
 */
export async function resetDatabase(client?: SupabaseClient): Promise<void> {
  const sb = client ?? createServiceClient();

  // 1. Delete all auth users; FKs in public.* cascade.
  const { data: usersData, error: listError } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    throw new Error(`resetDatabase: failed to list auth users: ${listError.message}`);
  }
  for (const user of usersData?.users ?? []) {
    const { error } = await sb.auth.admin.deleteUser(user.id);
    if (error) {
      throw new Error(`resetDatabase: failed to delete user ${user.id}: ${error.message}`);
    }
  }

  // 2. Truncate tables that don't FK to auth.users (or where we want
  //    belt-and-suspenders cleanup). RPC `truncate_all_test_tables` is not
  //    defined yet; we do it explicitly via deletes against an always-true
  //    predicate so the helper works without extra DB-side setup.
  const tablesToTruncate = ['rate_limit_buckets'];
  for (const table of tablesToTruncate) {
    const { error } = await sb.from(table).delete().neq('bucket_key', '__never__');
    // Swallow "no matching column" errors for tables that don't have the
    // hand-picked filter column — the table may not exist yet on older
    // branches. Other errors propagate.
    if (error && !error.message.includes('column')) {
      throw new Error(`resetDatabase: failed to truncate ${table}: ${error.message}`);
    }
  }
}

/**
 * Create a test auth user with a profile row in a single call. The role is
 * applied to `profiles.active_role` and `user_roles`; switching this user's
 * role in a test scenario must update both (use existing role helpers from
 * the app, not raw inserts).
 *
 * Returns the user id + email so the test can sign in later if it needs a
 * user-scoped client.
 */
export async function createTestUser(
  role: UserRole = ROLES.TALENT,
  overrides?: {
    email?: string;
    username?: string;
    display_name?: string;
  },
  client?: SupabaseClient,
): Promise<{ id: string; email: string; username: string }> {
  const sb = client ?? createServiceClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = overrides?.email ?? `test-${suffix}@picdemi.test`;
  const username = overrides?.username ?? `test_${suffix}`;

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: 'test-password-1234',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser: failed to create auth user: ${error?.message ?? 'no user'}`);
  }

  // profiles row may be auto-created by a trigger; upsert idempotently.
  const { error: profileError } = await sb.from('profiles').upsert(
    {
      id: data.user.id,
      username,
      display_name: overrides?.display_name ?? null,
      active_role: role,
    },
    { onConflict: 'id' },
  );
  if (profileError) {
    throw new Error(`createTestUser: failed to upsert profile: ${profileError.message}`);
  }

  // Record the role in user_roles so role-switching server actions see it.
  const { error: roleError } = await sb
    .from('user_roles')
    .upsert({ user_id: data.user.id, role }, { onConflict: 'user_id,role' });
  // Older schemas may not have user_roles or may have a different shape — log
  // and continue so tests that don't depend on role-switching still work.
  if (roleError) {
    console.warn(`createTestUser: user_roles upsert skipped: ${roleError.message}`);
  }

  return { id: data.user.id, email, username };
}

/**
 * Create a test event owned by `userId`. Returns the event id.
 */
export async function createTestEvent(
  userId: string,
  overrides?: Partial<{
    name: string;
    date: string;
    city: string;
    country: string;
    state: string;
    activity: string;
    is_public: boolean;
    slug: string;
    share_code: string;
    price_per_photo: number | null;
  }>,
  client?: SupabaseClient,
): Promise<{ id: string; slug: string | null; share_code: string | null }> {
  const sb = client ?? createServiceClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await sb
    .from('events')
    .insert({
      user_id: userId,
      name: overrides?.name ?? `Test Event ${suffix}`,
      date: overrides?.date ?? '2026-01-01',
      city: overrides?.city ?? 'Barcelona',
      country: overrides?.country ?? 'ES',
      // `state` (province/region) is NOT NULL in the deployed schema; supply
      // a sensible default so callers don't need to think about it.
      state: overrides?.state ?? 'Catalonia',
      activity: overrides?.activity ?? 'SURF',
      is_public: overrides?.is_public ?? true,
      slug: overrides?.slug ?? `test-event-${suffix}`,
      share_code: overrides?.share_code ?? suffix.toUpperCase(),
      price_per_photo: overrides?.price_per_photo ?? null,
    })
    .select('id, slug, share_code')
    .single();
  if (error || !data) {
    throw new Error(`createTestEvent: ${error?.message ?? 'no data'}`);
  }
  return { id: data.id, slug: data.slug, share_code: data.share_code };
}

/**
 * Create a test photo attached to `eventId` and owned by the event's user.
 * The `original_url` is set to a deterministic storage-style path; nothing
 * is actually uploaded to Storage.
 */
export async function createTestPhoto(
  eventId: string,
  overrides?: Partial<{
    user_id: string;
    original_url: string;
    taken_at: string;
    city: string;
    country: string;
  }>,
  client?: SupabaseClient,
): Promise<{ id: string }> {
  const sb = client ?? createServiceClient();

  // Default photographer = the event's owner unless the caller specifies.
  let photographerId = overrides?.user_id;
  if (!photographerId) {
    const { data: ev } = await sb.from('events').select('user_id').eq('id', eventId).single();
    photographerId = ev?.user_id;
    if (!photographerId) {
      throw new Error(`createTestPhoto: event ${eventId} not found`);
    }
  }

  const suffix = crypto.randomUUID();
  const { data, error } = await sb
    .from('photos')
    .insert({
      user_id: photographerId,
      event_id: eventId,
      original_url: overrides?.original_url ?? `${photographerId}/${eventId}/${suffix}.jpg`,
      taken_at: overrides?.taken_at ?? new Date().toISOString(),
      city: overrides?.city ?? 'Barcelona',
      country: overrides?.country ?? 'ES',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`createTestPhoto: ${error?.message ?? 'no data'}`);
  }
  return { id: data.id };
}
