/**
 * Regression tests for finding C1 from the May 2026 security audit.
 *
 * The audit found `/api/admin/payouts/[id]` only checked that the caller
 * was authenticated — any logged-in photographer could mark any payout as
 * paid. ⚠️ **That route no longer exists** (T-220 deleted the manual payout
 * approval flow: payout rows are written only by the transfer path and the
 * retry worker, and a status flip moves no money). The gate it introduced is
 * still live and still matters — `dashboard/admin/status/page.tsx` uses the
 * same lookup — so these tests stay, pinning the primitive rather than the
 * route. The fix introduced a dedicated `admin_users` table that:
 *
 *   1. is service-role-only (RLS enabled, no policies)
 *   2. is read via supabaseAdmin in the admin-gated surface
 *   3. cannot leak the list of admins through public PostgREST queries
 *      (which an earlier attempt with `profiles.is_admin` *did* leak via
 *      the public photographer profile policy)
 *
 * These tests pin those three properties at the data-layer. They do NOT
 * render the admin page — that needs a running server. The
 * underlying primitive (admin_users + the lookup pattern) is what carries
 * the security guarantee, so testing it directly is both lower-overhead
 * and more thorough.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

describe('admin_users — C1 regression', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('anon cannot read admin_users', async () => {
    const someone = await createTestUser('PHOTOGRAPHER');
    await createServiceClient().from('admin_users').insert({ user_id: someone.id });

    const { data, error } = await createAnonClient().from('admin_users').select('user_id');

    // Either an explicit permission error or just empty rows — the table
    // has RLS enabled and no policies, so anon must not see anything.
    expect(data ?? []).toEqual([]);
    if (error) {
      // Some PostgREST versions surface a 42501 here, others return [].
      expect(error.code === '42501' || error.code === undefined).toBe(true);
    }
  });

  it('authenticated non-admin cannot read admin_users (cannot discover other admins)', async () => {
    const admin = await createTestUser('PHOTOGRAPHER');
    const stranger = await createTestUser('PHOTOGRAPHER');
    await createServiceClient().from('admin_users').insert({ user_id: admin.id });

    const strangerClient = await signInAs(stranger.email);
    const { data } = await strangerClient.from('admin_users').select('user_id');

    expect(data ?? []).toEqual([]);
  });

  it('authenticated non-admin cannot write to admin_users', async () => {
    const attacker = await createTestUser('PHOTOGRAPHER');
    const attackerClient = await signInAs(attacker.email);

    const { error } = await attackerClient.from('admin_users').insert({ user_id: attacker.id });

    // Insert blocked by RLS (no policy permits it from the authenticated role).
    expect(error?.code).toBe('42501');

    const { count } = await createServiceClient()
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('service role can read + write admin_users (admin endpoint path)', async () => {
    // The admin endpoint reads via supabaseAdmin to determine if the caller
    // is an admin. Seeding admins is also a service-role-only operation.
    const target = await createTestUser('PHOTOGRAPHER');
    const sb = createServiceClient();

    const { error: insertErr } = await sb.from('admin_users').insert({ user_id: target.id });
    expect(insertErr).toBeNull();

    const { data } = await sb.from('admin_users').select('user_id').eq('user_id', target.id);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.user_id).toBe(target.id);
  });

  it('the admin lookup pattern returns null for non-admins (gate denies)', async () => {
    // Mirrors the actual code in [lang]/dashboard/admin/status/page.tsx:
    //   supabaseAdmin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
    //   if (!admin) → 403
    const admin = await createTestUser('PHOTOGRAPHER');
    const nonAdmin = await createTestUser('PHOTOGRAPHER');
    const sb = createServiceClient();
    await sb.from('admin_users').insert({ user_id: admin.id });

    const adminResult = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', admin.id)
      .maybeSingle();
    expect(adminResult.data?.user_id).toBe(admin.id);

    const nonAdminResult = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', nonAdmin.id)
      .maybeSingle();
    expect(nonAdminResult.data).toBeNull();
  });
});
