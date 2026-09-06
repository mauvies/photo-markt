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
 * Build an authenticated client signed in as a previously-created test user.
 * Uses the well-known password set by `createTestUser`. The returned client
 * is anon-key-backed but carries the user's session JWT, so RLS evaluates
 * `auth.uid()` against that user — exactly what authenticated app traffic
 * looks like.
 */
export async function signInAs(email: string): Promise<SupabaseClient> {
  const sb = createAnonClient();
  const { error } = await sb.auth.signInWithPassword({
    email,
    password: 'test-password-1234',
  });
  if (error) {
    throw new Error(`signInAs(${email}): ${error.message}`);
  }
  return sb;
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
/**
 * Ensure the `photos` storage bucket exists. Since migration
 * `20260702000000_create_photos_bucket.sql` the bucket is provisioned by the
 * migration set in every environment (prod, staging, local/CI), so this is now
 * a redundant safety net for tests that don't run a full `db reset`. Kept and
 * idempotent so signed-URL helper tests never depend on setup ordering.
 */
export async function ensurePhotosBucket(client?: SupabaseClient): Promise<void> {
  const sb = client ?? createServiceClient();
  const { error } = await sb.storage.createBucket('photos', { public: false });
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`ensurePhotosBucket: ${error.message}`);
  }
}

/**
 * Idempotently ensure the PUBLIC `avatars` bucket exists (T-182). Codified as a
 * migration (`create_avatars_bucket`), so this is a redundant safety net for
 * avatar-action tests that don't run a full `db reset`.
 */
export async function ensureAvatarsBucket(client?: SupabaseClient): Promise<void> {
  const sb = client ?? createServiceClient();
  const { error } = await sb.storage.createBucket('avatars', { public: true });
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`ensureAvatarsBucket: ${error.message}`);
  }
}

/**
 * Memoized pre-flight: confirm the local stack granted the API roles DML on
 * `public` tables before any integration test touches the DB. A Supabase CLI
 * bump once stripped these grants, turning a single provisioning gap into ~135
 * opaque `permission denied` failures (one per test, all in `beforeEach`).
 *
 * This probe runs once and, on the tell-tale `42501`, fails fast with the fix
 * instead of letting the cascade obscure the cause. It lives here (not in the
 * shared `setupFiles`) so it only fires for tests that actually hit the DB —
 * unit tests never import this module and stay Docker-free.
 */
let dbProvisioned = false;
export async function ensureDbProvisioned(client?: SupabaseClient): Promise<void> {
  if (dbProvisioned) return;
  const sb = client ?? createServiceClient();
  const { error } = await sb.from('profiles').select('id', { head: true, count: 'exact' });
  if (
    error &&
    (error.code === '42501' || error.message.toLowerCase().includes('permission denied'))
  ) {
    throw new Error(
      'Local Supabase is not provisioned for tests: the API roles lack DML on ' +
        'public tables (got "permission denied"). Run `pnpm db:reset` to apply ' +
        'the grants in supabase/seed.sql, then re-run the integration suite.',
    );
  }
  if (error) {
    throw new Error(`ensureDbProvisioned: unexpected error probing profiles: ${error.message}`);
  }
  dbProvisioned = true;
}

export async function resetDatabase(client?: SupabaseClient): Promise<void> {
  const sb = client ?? createServiceClient();
  await ensureDbProvisioned(sb);

  // 0. Wipe tables that (a) have `ON DELETE RESTRICT` FKs to auth.users —
  //    otherwise the auth-user delete in step 1 fails with a constraint
  //    violation (`order_items`, `guest_order_items`) — or (b) have NO FK
  //    to auth.users at all and therefore wouldn't be cascade-deleted
  //    (`guest_orders`, `pending_guest_checkouts`, `download_tokens`). Order
  //    matters: child rows before parents.
  for (const table of [
    'download_tokens',
    'order_items',
    'guest_order_items',
    'guest_orders',
    'pending_guest_checkouts',
  ]) {
    const { error } = await sb.from(table).delete().gt('created_at', '1900-01-01');
    if (error && !error.message.includes('does not exist')) {
      throw new Error(`resetDatabase: failed to wipe ${table}: ${error.message}`);
    }
  }

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
  //
  // ⚠️ Each entry names its OWN filter column. The loop above filters on
  // `created_at`, and its error guard swallows "does not exist" — so adding a
  // table without that column there would silently do nothing (T-227).
  const tablesToTruncate: { table: string; column: string; sentinel: string }[] = [
    { table: 'rate_limit_buckets', column: 'bucket_key', sentinel: '__never__' },
    // No FK to auth.users, so step 1 does not cascade it: without this, its rows
    // survive every reset and leak into the next test's assertions (T-227).
    {
      table: 'photos_orphan_storage_pending_cleanup',
      column: 'original_url',
      sentinel: '__never__',
    },
  ];
  for (const { table, column, sentinel } of tablesToTruncate) {
    const { error } = await sb.from(table).delete().neq(column, sentinel);
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
  const email = overrides?.email ?? `test-${suffix}@photomarkt.test`;
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

  // Record the role membership so role-switching server actions see it.
  // The app reads `user_role_memberships` (composite PK on user_id+role)
  // — NOT `user_roles`, which has a stale single-row-per-user constraint.
  const { error: roleError } = await sb
    .from('user_role_memberships')
    .upsert({ user_id: data.user.id, role }, { onConflict: 'user_id,role' });
  if (roleError) {
    console.warn(`createTestUser: user_role_memberships upsert skipped: ${roleError.message}`);
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
