/**
 * The seven tables with RLS enabled and ZERO policies (T-227).
 *
 * "RLS on, no policies" is Postgres's deny-everything: with no policy admitting a
 * row, `anon` and `authenticated` see nothing and write nothing, while
 * `service_role` bypasses RLS entirely. It is the strongest posture in the schema
 * and the cheapest to break — one well-meant `create policy` on a table nobody
 * remembers is service-role-only, and the barrier is gone.
 *
 * `admin_users` and `subscriptions` already have dedicated files (their own
 * regressions, with the surrounding product behaviour). This one is the sweep: it
 * proves the property for ALL seven in one table-driven loop, so a table that
 * silently gains a policy fails here as well as in the inventory.
 *
 * ⚠️ `admin_users` is the reason the set matters. It exists because `profiles`
 * carries a public SELECT policy, so `profiles.is_admin` was readable by anyone —
 * the flag was moved to a table with no policies at all (20260513000000). A
 * "helpful" policy here re-opens exactly that.
 *
 * Uses `beforeAll`, not `beforeEach(resetDatabase)`: every assertion is a read
 * that must come back empty or a write that must not land, so nothing mutates and
 * ordering cannot quietly pass or fail one. With `fileParallelism: false` a reset
 * per case is pure wall-clock.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonClient,
  createServiceClient,
  createTestEvent,
  createTestPhoto,
  createTestUser,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

/** FK targets the write probe needs; filled by the seed in `beforeAll`. */
const seeded = { guestOrderId: '', photoId: '', photographerId: '' };

const TOTAL_DENIAL_TABLES = [
  'admin_users',
  'rate_limit_buckets',
  'subscriptions',
  'guest_orders',
  'guest_order_items',
  'pending_guest_checkouts',
  'photos_orphan_storage_pending_cleanup',
] as const;

/**
 * A valid row for each table, distinct from the seeded one so a unique-key
 * collision cannot stand in for an RLS refusal.
 */
function probeRow(table: string, userId: string): Record<string, unknown> {
  switch (table) {
    case 'admin_users':
      return { user_id: userId };
    case 'rate_limit_buckets':
      return { bucket_key: 'probe-write', window_start: new Date().toISOString(), count: 1 };
    case 'subscriptions':
      return {
        user_id: userId,
        status: 'active',
        plan_id: 'pro',
        stripe_customer_id: 'cus_probe_write',
      };
    case 'guest_orders':
      return {
        guest_email: 'probe@example.com',
        total_amount_cents: 500,
        status: 'completed',
        stripe_checkout_session_id: 'cs_probe_write',
      };
    case 'guest_order_items':
      return {
        guest_order_id: seeded.guestOrderId,
        photo_id: seeded.photoId,
        photographer_id: seeded.photographerId,
        unit_price_cents: 500,
        total_price_cents: 500,
      };
    case 'pending_guest_checkouts':
      return { stripe_session_id: 'cs_probe_write', cart_items: [] };
    case 'photos_orphan_storage_pending_cleanup':
      return { original_url: 'photos/probe-write/orphan.webp' };
    default:
      throw new Error(`no probe row defined for ${table}`);
  }
}

describe('tables with RLS and no policies deny both API roles', () => {
  let user: { id: string; email: string };

  beforeAll(async () => {
    await resetDatabase();
    user = await createTestUser('TALENT');

    // Seed one row per table with the service role, so "no rows" below means RLS
    // refused them rather than the table simply being empty — the difference
    // between a proven barrier and a vacuous pass.
    const sb = createServiceClient();
    const seeds: { table: string; row: Record<string, unknown> }[] = [
      { table: 'admin_users', row: { user_id: user.id } },
      {
        table: 'rate_limit_buckets',
        row: { bucket_key: 'denial-test', window_start: new Date().toISOString(), count: 1 },
      },
      {
        table: 'subscriptions',
        // Keyed to the caller's OWN id on purpose: even your own row is invisible
        // here, which is what distinguishes total denial from own-row isolation.
        row: {
          user_id: user.id,
          status: 'active',
          plan_id: 'pro',
          stripe_customer_id: 'cus_denial_test',
        },
      },
      {
        table: 'guest_orders',
        row: {
          guest_email: 'guest@example.com',
          total_amount_cents: 500,
          status: 'completed',
          stripe_checkout_session_id: 'cs_denial_test',
        },
      },
      {
        table: 'pending_guest_checkouts',
        row: { stripe_session_id: 'cs_pending_denial_test', cart_items: [] },
      },
      {
        table: 'photos_orphan_storage_pending_cleanup',
        row: { original_url: 'photos/denial-test/orphan.webp' },
      },
    ];

    for (const { table, row } of seeds) {
      const { error } = await sb.from(table).insert(row);
      if (error) throw new Error(`seed for ${table} failed: ${error.message}`);
    }

    // `guest_order_items` needs its parent order and a real photo.
    const { data: guestOrder } = await sb
      .from('guest_orders')
      .select('id')
      .eq('stripe_checkout_session_id', 'cs_denial_test')
      .single();
    const photographer = await createTestUser('PHOTOGRAPHER');
    const event = await createTestEvent(photographer.id);
    const photo = await createTestPhoto(event.id, { user_id: photographer.id });
    const { error: itemError } = await sb.from('guest_order_items').insert({
      guest_order_id: guestOrder?.id,
      photo_id: photo.id,
      photographer_id: photographer.id,
      unit_price_cents: 500,
      total_price_cents: 500,
    });
    if (itemError) throw new Error(`seed for guest_order_items failed: ${itemError.message}`);

    seeded.guestOrderId = guestOrder?.id as string;
    seeded.photoId = photo.id;
    seeded.photographerId = photographer.id;
  });

  it.each(TOTAL_DENIAL_TABLES)('anon reads nothing from %s', async (table) => {
    const { data, error } = await createAnonClient().from(table).select('*');

    expect(data ?? []).toEqual([]);
    // Some PostgREST versions surface 42501, others just filter to zero rows.
    if (error) expect(error.code === '42501' || error.code === undefined).toBe(true);
  });

  it.each(TOTAL_DENIAL_TABLES)('an authenticated user reads nothing from %s', async (table) => {
    const client = await signInAs(user.email);
    const { data, error } = await client.from(table).select('*');

    expect(data ?? []).toEqual([]);
    if (error) expect(error.code === '42501' || error.code === undefined).toBe(true);
  });

  it.each(TOTAL_DENIAL_TABLES)('an authenticated user cannot write to %s', async (table) => {
    // ⚠️ The probe row must be VALID for the table. A row with a column the table
    // does not have comes back as PGRST204 from PostgREST's schema cache — the
    // request never reaches Postgres, so RLS refused nothing and the test would
    // pass while proving nothing. Same for a duplicate unique key (23505). Only a
    // 42501 means the policy layer is what said no.
    const client = await signInAs(user.email);
    const { error } = await client.from(table).insert(probeRow(table, user.id)).select();

    expect(error?.code).toBe('42501');
  });

  it('the service role can still read every one of them', async () => {
    // Positive control for the whole set: the webhook, the Inngest workers and the
    // admin surface all depend on these tables being reachable with the service
    // key. Without this, the seven assertions above would also pass if the tables
    // were simply broken.
    const sb = createServiceClient();
    for (const table of TOTAL_DENIAL_TABLES) {
      const { data, error } = await sb.from(table).select('*');
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });
});
