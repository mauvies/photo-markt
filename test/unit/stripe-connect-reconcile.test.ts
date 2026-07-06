/**
 * Unit tests for `reconcileConnectStatus` and `reconcileAndPersistConnectStatus`
 * (`src/lib/stripe/connect.ts`).
 *
 * Regression for T-074: a lagged/missed `account.updated` webhook leaves
 * `profiles.stripe_connect_status` stale — most damagingly a `pending` value
 * for an account that is actually active. The helper re-derives the live
 * status from Stripe so the dashboard banner, payout-profile page, and webhook
 * transfer gate can heal the cached value instead of trusting it blindly.
 *
 * Stripe is mocked at the config boundary so this runs with no network/DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { accounts: { retrieve: vi.fn() } },
}));

vi.mock('@/lib/stripe/config', () => ({ stripe: stripeMock }));

import type { SupabaseServerClient } from '@/database/queries/types';
import { reconcileAndPersistConnectStatus, reconcileConnectStatus } from '@/lib/stripe/connect';

/**
 * Minimal fake matching the `from('profiles').update(data).eq('id', userId)`
 * chain that `updateProfileStripeConnect` awaits. `eq` resolves to `{ error }`.
 */
function makeFakeClient() {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseServerClient, from, update, eq };
}

describe('reconcileConnectStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the stored status unchanged when there is no account id', async () => {
    const result = await reconcileConnectStatus(null, 'pending');
    expect(result).toEqual({ status: 'pending', changed: false });
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it('promotes a stale `pending` to `active` when the live account is fully enabled', async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
    });
    const result = await reconcileConnectStatus('acct_1', 'pending');
    expect(result).toEqual({ status: 'active', changed: true });
  });

  it('reports no change when the live status already matches the stored one', async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
    });
    const result = await reconcileConnectStatus('acct_1', 'active');
    expect(result).toEqual({ status: 'active', changed: false });
  });

  it('surfaces a live downgrade (details submitted, payouts not yet enabled → restricted)', async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    });
    const result = await reconcileConnectStatus('acct_1', 'active');
    expect(result).toEqual({ status: 'restricted', changed: true });
  });

  it('falls back to the stored status when the account can not be retrieved', async () => {
    stripeMock.accounts.retrieve.mockRejectedValueOnce(new Error('stripe down'));
    const result = await reconcileConnectStatus('acct_1', 'pending');
    expect(result).toEqual({ status: 'pending', changed: false });
  });
});

describe('reconcileAndPersistConnectStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trusts an active cached status without calling Stripe or writing', async () => {
    // The hot-path guard: an already-active account must NOT trigger a blocking
    // Stripe call on every dashboard load, and legitimate downgrades come from
    // the account.updated webhook, not this best-effort read.
    const { client, from } = makeFakeClient();
    const result = await reconcileAndPersistConnectStatus({
      client,
      userId: 'u1',
      accountId: 'acct_1',
      storedStatus: 'active',
    });
    expect(result).toBe('active');
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns the stored status without a write when there is no account id', async () => {
    const { client, from } = makeFakeClient();
    const result = await reconcileAndPersistConnectStatus({
      client,
      userId: 'u1',
      accountId: null,
      storedStatus: 'pending',
    });
    expect(result).toBe('pending');
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('heals a stale pending → active and persists the change (awaited)', async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
    });
    const { client, update } = makeFakeClient();
    const result = await reconcileAndPersistConnectStatus({
      client,
      userId: 'u1',
      accountId: 'acct_1',
      storedStatus: 'pending',
    });
    expect(result).toBe('active');
    expect(update).toHaveBeenCalledWith({ stripe_connect_status: 'active' });
  });

  it('does not write when the live status matches the (non-active) stored one', async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce({
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
    const { client, from } = makeFakeClient();
    const result = await reconcileAndPersistConnectStatus({
      client,
      userId: 'u1',
      accountId: 'acct_1',
      storedStatus: 'pending',
    });
    expect(result).toBe('pending');
    expect(from).not.toHaveBeenCalled();
  });
});
