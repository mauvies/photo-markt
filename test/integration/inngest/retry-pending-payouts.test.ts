/**
 * Integration tests for `retryPendingPayouts` (T-216).
 *
 * Drives the exported flow body directly against local Supabase with a
 * pass-through step and stubbed Stripe deps — the same shape as
 * `reconcile-indexing.test.ts`. No Inngest runtime, no Stripe account.
 *
 * The two acceptance criteria from the ticket are covered by
 * "pays a held payout once the account becomes active" and
 * "accumulates two sub-minimum holds into a single transfer".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payout, PayoutHoldReason } from '@/database/queries/payouts';
import {
  type RetryPayoutsDeps,
  retryPendingPayouts,
  runRetryPendingPayoutsFlow,
} from '@/lib/inngest/functions/retry-pending-payouts';
import type { InngestStepRunner } from '@/lib/inngest/step';
import {
  createServiceClient,
  createTestUser,
  resetDatabase,
} from '../../helpers/supabase-test-client';

// T-264: the alert channel is unit-tested on its own; here we only assert the
// worker reaches it, so a stub keeps Sentry and Resend out of the run.
vi.mock('@/lib/observability/report-money-incident', () => ({
  reportMoneyIncident: vi.fn(async () => undefined),
}));

/**
 * T-254: the two stuck-hold selectors are the only thing between a stranded
 * payout and silence, so their failure and truncation branches need covering —
 * and neither is reachable through the real database without a broken schema or
 * 500 seeded rows. Everything else in the module stays REAL: the hook delegates
 * to the actual query unless a test installs an override.
 */
const stuckSelectorOverrides = vi.hoisted(() => ({
  listStuckRetryableRows: null as null | (() => Promise<unknown>),
  listAgedOutstandingHolds: null as null | (() => Promise<unknown>),
}));

vi.mock('@/database/queries/payouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/database/queries/payouts')>();
  return {
    ...actual,
    listStuckRetryableRows: (...args: Parameters<typeof actual.listStuckRetryableRows>) =>
      stuckSelectorOverrides.listStuckRetryableRows?.() ?? actual.listStuckRetryableRows(...args),
    listAgedOutstandingHolds: (...args: Parameters<typeof actual.listAgedOutstandingHolds>) =>
      stuckSelectorOverrides.listAgedOutstandingHolds?.() ??
      actual.listAgedOutstandingHolds(...args),
  };
});

const MINUTE_MS = 60 * 1000;
/** An hour ahead makes anything written "now" older than the 30-minute window. */
const FUTURE_NOW = Date.now() + 60 * MINUTE_MS;
/** Seven hours ahead clears the 6-hour dispute-freeze window too (T-265). */
const FREEZE_FUTURE_NOW = Date.now() + 7 * 60 * MINUTE_MS;

const passthroughStep: InngestStepRunner = {
  async run<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  },
};

interface TransferCall {
  amountCents: number;
  currency: string;
  destination: string;
  sourceTransaction?: string;
  transferGroup?: string;
  idempotencyKey: string;
}

/** Stripe stubs: record every transfer, answer probes from a scripted result. */
function makeDeps(overrides: Partial<RetryPayoutsDeps> = {}): {
  deps: RetryPayoutsDeps;
  calls: TransferCall[];
} {
  const calls: TransferCall[] = [];
  let counter = 0;
  const deps: RetryPayoutsDeps = {
    createTransfer: vi.fn(async (params: TransferCall) => {
      calls.push(params);
      counter += 1;
      return { id: `tr_stub_${counter}` } as never;
    }),
    findTransferByGroup: vi.fn(async () => ({ outcome: 'none' }) as never),
    // T-265: inert by default — an OPEN dispute is "not stuck", so a test that
    // seeds no freeze can never trip the sweep. Tests that care override it.
    retrieveDisputeOutcome: vi.fn(
      async () => ({ outcome: 'open', status: 'needs_response' }) as never,
    ),
    // A charge with no refunds is the only shape the sweep may release.
    retrieveChargeRefundState: vi.fn(async () => ({ amountRefundedCents: 0 })),
    // The webhook's live-reconcile helper: pass the stored status straight
    // through so the DB row is what decides.
    reconcileAndPersistConnectStatus: vi.fn(
      async (params: { storedStatus: string }) => params.storedStatus as never,
    ),
    ...overrides,
  };
  return { deps, calls };
}

async function makePhotographer(opts: { connectStatus?: string; accountId?: string | null }) {
  const sb = createServiceClient();
  const user = await createTestUser('PHOTOGRAPHER');
  await sb
    .from('profiles')
    .update({
      stripe_connect_account_id: opts.accountId === undefined ? 'acct_stub' : opts.accountId,
      stripe_connect_status: opts.connectStatus ?? 'active',
    })
    .eq('id', user.id);
  return user;
}

async function seedHold(opts: {
  photographerId: string;
  amountCents: number;
  chargeId: string;
  currency?: string;
  holdReason?: PayoutHoldReason;
  status?: string;
  transferBatchId?: string | null;
  frozenByDisputeId?: string | null;
  voidReason?: string | null;
  reversedCents?: number;
  /** The sweep refuses to release a hold whose order is still revoked (T-265). */
  orderStatus?: string;
}) {
  const sb = createServiceClient();

  // Production always opens a payout row against an order (`openPayoutRow` is
  // called with `order_id`/`order_kind`), and the freeze sweep reads that order's
  // status before releasing anything — so the fixture seeds a real one.
  const buyer = await createTestUser('TALENT');
  const { data: order, error: orderError } = await sb
    .from('orders')
    .insert({
      user_id: buyer.id,
      total_amount_cents: opts.amountCents,
      currency: opts.currency ?? 'eur',
      status: opts.orderStatus ?? 'completed',
    })
    .select('id')
    .single();
  if (orderError || !order) throw new Error(`order seed failed: ${orderError?.message}`);

  const { data, error } = await sb
    .from('payouts')
    .insert({
      photographer_id: opts.photographerId,
      amount_cents: opts.amountCents,
      currency: opts.currency ?? 'eur',
      stripe_charge_id: opts.chargeId,
      hold_reason: opts.holdReason ?? 'connect_inactive',
      status: opts.status ?? 'pending',
      transfer_batch_id: opts.transferBatchId ?? null,
      frozen_by_dispute_id: opts.frozenByDisputeId ?? null,
      void_reason: opts.voidReason ?? null,
      reversed_amount_cents: opts.reversedCents ?? 0,
      order_id: order.id,
      order_kind: 'order',
    })
    .select()
    .single();
  if (error || !data) throw new Error(`hold seed failed: ${error?.message}`);
  return data as Payout;
}

async function readPayout(id: string) {
  const { data } = await createServiceClient()
    .from('payouts')
    .select(
      'status, amount_cents, stripe_transfer_id, hold_reason, transfer_batch_id, frozen_by_dispute_id, void_reason',
    )
    .eq('id', id)
    .single();
  return data;
}

describe('retry-pending-payouts — function config guard', () => {
  it('runs on a cron slot that does not contend with the other two crons', () => {
    // 0,30 is cleanup-orphaned-storage and 15,45 is reconcile-indexing.
    expect(retryPendingPayouts.opts.triggers).toEqual([
      { cron: '10,40 * * * *' },
      { event: 'payouts.retry-requested' },
    ]);
  });

  it('registers the cron and the event on ONE function', () => {
    // ⚠️ Inngest scopes `concurrency` per function id. Two registrations would
    // mean two independent limits, allowing concurrent runs for one photographer.
    expect(retryPendingPayouts.opts.triggers).toHaveLength(2);
    expect(retryPendingPayouts.opts.concurrency).toEqual({ limit: 1 });
  });

  it('debounces the activation event, which Stripe emits in bursts', () => {
    expect(retryPendingPayouts.opts.debounce).toEqual({
      key: 'event.data.photographerId',
      period: '60s',
    });
  });
});

describe('runRetryPendingPayoutsFlow', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('pays a held payout once the account becomes active', async () => {
    // Ticket acceptance criterion 1: sale with an inactive account → held row →
    // activation → transfer issued.
    const photographer = await makePhotographer({ connectStatus: 'pending', accountId: null });
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_activate',
    });

    // Still inactive: nothing moves.
    const { deps, calls } = makeDeps();
    const first = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    expect(calls).toHaveLength(0);
    expect(first.photographersNotActive).toBe(1);
    expect((await readPayout(hold.id))?.status).toBe('pending');

    // Onboarding completes.
    await createServiceClient()
      .from('profiles')
      .update({ stripe_connect_account_id: 'acct_live', stripe_connect_status: 'active' })
      .eq('id', photographer.id);

    const second = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.amountCents).toBe(460);
    expect(calls[0]?.destination).toBe('acct_live');
    // Kept on the individual path: ties the transfer to the charge's funds and
    // lets Stripe refuse an over-draw long after the idempotency key expires.
    expect(calls[0]?.sourceTransaction).toBe('ch_activate');
    expect(calls[0]?.idempotencyKey).toBe(`payout_${hold.id}`);
    expect(second.rowsPaid).toBe(1);

    const after = await readPayout(hold.id);
    expect(after?.status).toBe('paid');
    expect(after?.stripe_transfer_id).toBe('tr_stub_1');
    expect(after?.hold_reason).toBeNull();
  });

  it('accumulates two sub-minimum holds into a single transfer', async () => {
    // Ticket acceptance criterion 2. Neither 30-cent row is individually
    // transferable; together they clear Stripe's floor.
    const photographer = await makePhotographer({});
    const a = await seedHold({
      photographerId: photographer.id,
      amountCents: 30,
      chargeId: 'ch_a',
      holdReason: 'below_minimum',
    });
    const b = await seedHold({
      photographerId: photographer.id,
      amountCents: 30,
      chargeId: 'ch_b',
      holdReason: 'below_minimum',
    });

    const { deps, calls } = makeDeps();
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.amountCents).toBe(60);
    // A batch spans several charges, so Stripe forbids source_transaction here.
    expect(calls[0]?.sourceTransaction).toBeUndefined();
    expect(calls[0]?.idempotencyKey).toBe(calls[0]?.transferGroup);
    expect(result.rowsPaid).toBe(2);
    expect(result.centsPaid).toBe(60);

    const [afterA, afterB] = await Promise.all([readPayout(a.id), readPayout(b.id)]);
    expect(afterA?.status).toBe('paid');
    expect(afterB?.status).toBe('paid');
    // Both settled by the SAME transfer — which is why UNIQUE(stripe_transfer_id)
    // had to go.
    expect(afterA?.stripe_transfer_id).toBe('tr_stub_1');
    expect(afterB?.stripe_transfer_id).toBe('tr_stub_1');
  });

  it('leaves a group still short of the minimum outstanding', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 20,
      chargeId: 'ch_small',
      holdReason: 'below_minimum',
    });

    const { deps, calls } = makeDeps();
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect(result.groupsBelowMinimum).toBe(1);
    expect((await readPayout(hold.id))?.status).toBe('pending');
  });

  it('never merges two currencies into one transfer', async () => {
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 40,
      chargeId: 'ch_eur',
      currency: 'eur',
      holdReason: 'below_minimum',
    });
    await seedHold({
      photographerId: photographer.id,
      amountCents: 40,
      chargeId: 'ch_usd',
      currency: 'usd',
      holdReason: 'below_minimum',
    });

    const { deps, calls } = makeDeps();
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    // 80 cents total, but split across currencies neither group clears 50.
    expect(calls).toHaveLength(0);
    expect(result.groupsBelowMinimum).toBe(2);
  });

  it('transfers nothing more on a second run', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_once',
    });

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    expect(calls).toHaveLength(1);

    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    expect(calls).toHaveLength(1);
    expect((await readPayout(hold.id))?.status).toBe('paid');
  });

  it('leaves the row payable when the transfer throws', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_fail',
    });

    const { deps } = makeDeps({
      createTransfer: vi.fn(async () => {
        throw new Error('stripe down');
      }),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(result.rowsPaid).toBe(0);
    // Still pending, so the next tick retries it — under the same key, so a
    // transfer Stripe did make despite the throw is returned, not duplicated.
    expect((await readPayout(hold.id))?.status).toBe('pending');
  });

  it('ignores rows that predate the ledger', async () => {
    // ⚠️ Security filter, not tidiness. Until T-216 an RLS policy let
    // photographers INSERT their own `pending` payouts. Such rows carry no
    // charge and no hold_reason, and must never be wired to real money.
    const photographer = await makePhotographer({});
    const sb = createServiceClient();
    const { data: legacy } = await sb
      .from('payouts')
      .insert({ photographer_id: photographer.id, amount_cents: 999_00, status: 'pending' })
      .select('id')
      .single();
    if (!legacy) throw new Error('legacy seed failed');

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect((await readPayout(legacy.id))?.status).toBe('pending');
  });

  it('skips a photographer with no Connect account at all', async () => {
    const photographer = await makePhotographer({
      connectStatus: 'not_connected',
      accountId: null,
    });
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_noacct',
    });

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect((await readPayout(hold.id))?.status).toBe('pending');
  });

  describe('stale batch recovery', () => {
    it('settles from an existing transfer instead of sending a second one', async () => {
      // The batch id outlives Stripe's 24h idempotency window, so a blind
      // re-drive could pay twice. The probe is what closes that.
      const photographer = await makePhotographer({});
      const batchId = '11111111-1111-4111-8111-111111111111';
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 30,
        chargeId: 'ch_stale_a',
        holdReason: 'below_minimum',
        status: 'processing',
        transferBatchId: batchId,
      });
      const b = await seedHold({
        photographerId: photographer.id,
        amountCents: 30,
        chargeId: 'ch_stale_b',
        holdReason: 'below_minimum',
        status: 'processing',
        transferBatchId: batchId,
      });

      const { deps, calls } = makeDeps({
        findTransferByGroup: vi.fn(
          async () => ({ outcome: 'found', transfer: { id: 'tr_already_sent' } }) as never,
        ),
      });
      const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      expect(calls).toHaveLength(0);
      expect(result.batchesRecovered).toBe(1);

      const [afterA, afterB] = await Promise.all([readPayout(a.id), readPayout(b.id)]);
      expect(afterA?.status).toBe('paid');
      expect(afterB?.status).toBe('paid');
      expect(afterA?.stripe_transfer_id).toBe('tr_already_sent');
    });

    it('re-drives under the same batch id when Stripe has no such transfer', async () => {
      const photographer = await makePhotographer({});
      const batchId = '22222222-2222-4222-8222-222222222222';
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 60,
        chargeId: 'ch_redrive',
        holdReason: 'below_minimum',
        status: 'processing',
        transferBatchId: batchId,
      });

      const { deps, calls } = makeDeps();
      const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      expect(calls).toHaveLength(1);
      // Same batch id ⇒ same idempotency key as the run that died.
      expect(calls[0]?.idempotencyKey).toBe(`payout_batch_${batchId}`);
      expect(result.transfersCreated).toBe(1);
      expect((await readPayout(a.id))?.status).toBe('paid');
    });

    it('does NOT transfer when the transfer lookup is inconclusive', async () => {
      // A Stripe read blip must never be read as "nothing was sent" — that is
      // precisely how a recovery probe becomes a double payment.
      const photographer = await makePhotographer({});
      const batchId = '33333333-3333-4333-8333-333333333333';
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 60,
        chargeId: 'ch_unknown',
        holdReason: 'below_minimum',
        status: 'processing',
        transferBatchId: batchId,
      });

      const { deps, calls } = makeDeps({
        findTransferByGroup: vi.fn(async () => ({ outcome: 'unknown' }) as never),
      });
      await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      expect(calls).toHaveLength(0);
      expect((await readPayout(a.id))?.status).toBe('processing');
    });

    it('leaves a freshly-claimed batch alone', async () => {
      // The staleness window is what stops the sweeper fighting a run that is
      // still in progress. `Date.now()` (not FUTURE_NOW) keeps the row fresh.
      const photographer = await makePhotographer({});
      const batchId = '44444444-4444-4444-8444-444444444444';
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 60,
        chargeId: 'ch_fresh',
        holdReason: 'below_minimum',
        status: 'processing',
        transferBatchId: batchId,
      });

      const { deps, calls } = makeDeps();
      await runRetryPendingPayoutsFlow(passthroughStep, Date.now(), deps);

      expect(calls).toHaveLength(0);
      expect((await readPayout(a.id))?.status).toBe('processing');
    });
  });

  /**
   * An individual transfer now claims its row out of `pending` before calling
   * Stripe, which closes a real double-payment window: a run that transferred and
   * then failed to write `settlePayoutPaid` used to leave a paid row looking
   * unpaid. The idempotency key hides that for 24h and then expires — the row does
   * not — so the next tick sent the money again.
   *
   * The claim only helps if abandoned claims are recovered, or it trades that
   * window for a permanent one: a `processing` row is invisible to
   * `listPayableHolds` and nothing else looks for it. These pin the recovery.
   */
  describe('stale single-row claim recovery', () => {
    it('settles from an existing transfer instead of sending a second one', async () => {
      const photographer = await makePhotographer({});
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 900,
        chargeId: 'ch_stale_single',
        holdReason: 'connect_inactive',
        status: 'processing',
      });

      const { deps, calls } = makeDeps({
        findTransferByGroup: vi.fn(
          async () => ({ outcome: 'found', transfer: { id: 'tr_single_already_sent' } }) as never,
        ),
      });
      await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      expect(calls).toHaveLength(0);
      const after = await readPayout(a.id);
      expect(after?.status).toBe('paid');
      expect(after?.stripe_transfer_id).toBe('tr_single_already_sent');
    });

    it('hands the claim back as a hold when Stripe confirms nothing was sent', async () => {
      const photographer = await makePhotographer({});
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 900,
        chargeId: 'ch_stale_single_none',
        holdReason: 'connect_inactive',
        status: 'processing',
      });

      const { deps, calls } = makeDeps();
      const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      // The claim is handed back rather than left stranded …
      expect(result.releasedClaims).toBeGreaterThan(0);
      // … and the same tick then pays it through the normal path, which is safe
      // because the release marks it `transfer_failed` and that reason makes the
      // payer PROBE before sending. Exactly one transfer, never two.
      expect(calls).toHaveLength(1);
      const after = await readPayout(a.id);
      expect(after?.status).toBe('paid');
      expect(after?.status).not.toBe('processing');
    });

    it('does NOT release a claim when the lookup is inconclusive', async () => {
      // Same rule as everywhere else on this path: a Stripe read blip is never
      // "nothing was sent".
      const photographer = await makePhotographer({});
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 900,
        chargeId: 'ch_stale_single_unknown',
        holdReason: 'connect_inactive',
        status: 'processing',
      });

      const { deps, calls } = makeDeps({
        findTransferByGroup: vi.fn(async () => ({ outcome: 'unknown' }) as never),
      });
      await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

      expect(calls).toHaveLength(0);
      expect((await readPayout(a.id))?.status).toBe('processing');
    });

    it('leaves a freshly-claimed row alone', async () => {
      const photographer = await makePhotographer({});
      const a = await seedHold({
        photographerId: photographer.id,
        amountCents: 900,
        chargeId: 'ch_fresh_single',
        holdReason: 'connect_inactive',
        status: 'processing',
      });

      const { deps, calls } = makeDeps();
      await runRetryPendingPayoutsFlow(passthroughStep, Date.now(), deps);

      expect(calls).toHaveLength(0);
      expect((await readPayout(a.id))?.status).toBe('processing');
    });
  });
});

/**
 * ⚠️ Cross-writer regression (found in security review of T-216).
 *
 * Stripe's idempotency layer compares the ENTIRE request body against the one
 * first stored under a key and rejects any divergence with a 400. So sharing the
 * key between the webhook and this worker buys nothing unless the parameters
 * match too.
 *
 * They originally did not: the webhook sent `transfer_group = orderId` while the
 * worker sent a payout-derived group, both under `payout_<rowId>`. Every
 * `transfer_failed` hold — the one hold reason created AFTER a Stripe call was
 * already made — would then 400 on every retry for the key's whole 24-hour life,
 * logged indistinguishably from a Stripe outage; and once the key expired, the
 * retry would issue a genuine SECOND transfer.
 */
describe('retry-pending-payouts — parameter parity with the webhook', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('sends a transfer_group derived from the payout id, matching the webhook', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_parity',
    });

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(1);
    // The webhook asserts the identical shape in stripe-webhook.test.ts.
    expect(calls[0]?.transferGroup).toBe(`payout_${hold.id}`);
    expect(calls[0]?.idempotencyKey).toBe(`payout_${hold.id}`);
  });

  it('recovers a transfer_failed hold from an existing transfer instead of re-sending', async () => {
    // The webhook issued a transfer and never saw the response. Past the 24-hour
    // idempotency window the key no longer replays Stripe's answer, so a blind
    // re-drive would pay twice — `source_transaction` alone does not stop it when
    // a multi-photographer order leaves headroom on the charge.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_lost_response',
      holdReason: 'transfer_failed',
    });

    const { deps, calls } = makeDeps({
      findTransferByGroup: vi.fn(
        async () => ({ outcome: 'found', transfer: { id: 'tr_sent_but_unseen' } }) as never,
      ),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect(result.rowsPaid).toBe(1);

    const after = await readPayout(hold.id);
    expect(after?.status).toBe('paid');
    expect(after?.stripe_transfer_id).toBe('tr_sent_but_unseen');
  });

  it('does NOT re-drive a transfer_failed hold when the lookup is inconclusive', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_probe_blip',
      holdReason: 'transfer_failed',
    });

    const { deps, calls } = makeDeps({
      findTransferByGroup: vi.fn(async () => ({ outcome: 'unknown' }) as never),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect((await readPayout(hold.id))?.status).toBe('pending');
  });

  it('re-drives a transfer_failed hold when Stripe confirms nothing was sent', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_never_sent',
      holdReason: 'transfer_failed',
    });

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.idempotencyKey).toBe(`payout_${hold.id}`);
    expect((await readPayout(hold.id))?.status).toBe('paid');
  });

  it('does not probe a connect_inactive hold — no Stripe call was ever made', async () => {
    // The probe costs a Stripe round-trip; it is only warranted where a call may
    // already have happened under this key.
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 460,
      chargeId: 'ch_never_touched',
      holdReason: 'connect_inactive',
    });

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(deps.findTransferByGroup).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

/**
 * T-264 — reversals reserved but never confirmed.
 *
 * `reservePayoutReversal` writes BEFORE the Stripe call, deliberately: a crash in
 * between makes the row claw back LESS next time, never more. The cost is a row
 * that is permanently wrong and that NOTHING selects — `listPayableHolds` wants
 * `pending` + a `hold_reason`, the stale-batch selectors want `processing`. And
 * `listUnconfirmedReversals`, which exists precisely for this, had zero callers.
 */
describe('runRetryPendingPayoutsFlow — unconfirmed reversals (T-264)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  /** A row whose money left the platform and whose reversal was reserved. */
  async function seedUnconfirmedReversal(opts: {
    photographerId: string;
    amountCents: number;
    reversedCents: number;
    status?: string;
    reversedAt?: string;
    reversalId?: string | null;
  }) {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from('payouts')
      .insert({
        photographer_id: opts.photographerId,
        amount_cents: opts.amountCents,
        currency: 'eur',
        stripe_charge_id: `ch_${opts.photographerId.slice(0, 8)}_${opts.reversedCents}`,
        status: opts.status ?? 'paid',
        stripe_transfer_id: 'tr_seeded',
        reversed_amount_cents: opts.reversedCents,
        reversed_at: opts.reversedAt ?? new Date(Date.now() - 3 * 60 * MINUTE_MS).toISOString(),
        stripe_reversal_id: opts.reversalId ?? null,
        order_kind: 'order',
      })
      .select()
      .single();
    if (error || !data) throw new Error(`reversal seed failed: ${error?.message}`);
    return data as Payout;
  }

  it('reports a stranded reversal that nothing else would ever select', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    const row = await seedUnconfirmedReversal({
      photographerId: photographer.id,
      amountCents: 1000,
      reversedCents: 400,
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reversal-unconfirmed' }),
    );
    const reported = vi.mocked(reportMoneyIncident).mock.calls[0]?.[0];
    expect(reported?.context?.oldestPayoutId).toBe(row.id);
    expect(reported?.context?.rowCount).toBe(1);
  });

  it('does NOT report a hold reduced by a partial refund — the false positive the selector had to exclude', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    // `applyReversalToHolds` stamps `reversed_at` on an outstanding hold. There is
    // no transfer to reverse, so `stripe_reversal_id` will never be set and the
    // row would match forever without the status filter.
    await seedUnconfirmedReversal({
      photographerId: photographer.id,
      amountCents: 1000,
      reversedCents: 400,
      status: 'pending',
    });
    await seedUnconfirmedReversal({
      photographerId: photographer.id,
      amountCents: 800,
      reversedCents: 800,
      status: 'cancelled',
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reversal-unconfirmed' }),
    );
  });

  it('does NOT report a reversal that was confirmed', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    await seedUnconfirmedReversal({
      photographerId: photographer.id,
      amountCents: 1000,
      reversedCents: 400,
      reversalId: 'trr_confirmed',
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    expect(vi.mocked(reportMoneyIncident)).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reversal-unconfirmed' }),
    );
  });

  it('alerts once per day, not once per cron pass', async () => {
    const photographer = await createTestUser('PHOTOGRAPHER');
    await seedUnconfirmedReversal({
      photographerId: photographer.id,
      amountCents: 1000,
      reversedCents: 400,
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    const reversalAlerts = vi
      .mocked(reportMoneyIncident)
      .mock.calls.filter(([incident]) => incident.kind === 'reversal-unconfirmed');
    expect(reversalAlerts).toHaveLength(1);
  });
});

/**
 * T-265: a dispute freeze is a MARK, not a status — `listPayableHolds` refuses
 * every row carrying `frozen_by_dispute_id`, and `restoreHoldsForCharge` (only
 * reachable from `charge.dispute.closed`) is its only writer. One failed unfreeze
 * therefore strands the row permanently. This sweep is its only way out.
 *
 * ⚠️ It repairs where the reversal sweep above deliberately does not, and these
 * tests pin why that is safe: it acts ONLY on a dispute Stripe reports as closed
 * and not lost, and treats every other answer — including a failed read — as
 * "touch nothing".
 */
describe('runRetryPendingPayoutsFlow — stale dispute freezes (T-265)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  async function freezeAlerts() {
    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    return vi
      .mocked(reportMoneyIncident)
      .mock.calls.filter(([incident]) => incident.kind === 'dispute-freeze-stuck');
  }

  it('releases a freeze whose dispute closed without loss, and pays the row in the same pass', async () => {
    // The failure this recovers: the webhook's `restoreHoldsForCharge` threw, so
    // the won dispute never released the mark.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_won',
      frozenByDisputeId: 'dp_won',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(
        async () => ({ outcome: 'closed-not-lost', status: 'won' }) as never,
      ),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(1);
    expect(result.freezesUnresolved).toBe(0);
    expect(await freezeAlerts()).toHaveLength(0);

    const after = await readPayout(hold.id);
    expect(after?.frozen_by_dispute_id).toBeNull();
    // The step runs before the payable-holds step precisely so this happens now
    // rather than 30 minutes later.
    expect(calls).toHaveLength(1);
    expect(after?.status).toBe('paid');
  });

  it('restores a chargeback-voided hold, but not one a real refund voided', async () => {
    // `restoreHoldsForCharge` is the webhook's own operation, so the sweep
    // inherits its scoping: a refund really did take that money back.
    // Two photographers on one charge: the exactly-once index is
    // `(stripe_charge_id, photographer_id)`, so one charge cannot hold two rows
    // for the same photographer anyway.
    const frozenPhotographer = await makePhotographer({});
    const refundedPhotographer = await makePhotographer({});
    const byDispute = await seedHold({
      photographerId: frozenPhotographer.id,
      amountCents: 900,
      chargeId: 'ch_mixed',
      status: 'cancelled',
      voidReason: 'dispute',
      frozenByDisputeId: 'dp_mixed',
    });
    const byRefund = await seedHold({
      photographerId: refundedPhotographer.id,
      amountCents: 700,
      chargeId: 'ch_mixed',
      status: 'cancelled',
      voidReason: 'refund',
      frozenByDisputeId: 'dp_mixed',
    });

    const { deps } = makeDeps({
      retrieveDisputeOutcome: vi.fn(
        async () => ({ outcome: 'closed-not-lost', status: 'warning_closed' }) as never,
      ),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    // Un-voided and released — and then paid in the same pass, which is the
    // point of running this step before `resolve-payable-holds`.
    const restored = await readPayout(byDispute.id);
    expect(restored?.void_reason).toBeNull();
    expect(restored?.frozen_by_dispute_id).toBeNull();
    expect(restored?.status).toBe('paid');

    const refunded = await readPayout(byRefund.id);
    expect(refunded?.status).toBe('cancelled');
    expect(refunded?.void_reason).toBe('refund');
  });

  it('never restores a LOST dispute, but clears its mark so the set drains', async () => {
    // A lost chargeback keeps its mark forever, and locally it is
    // indistinguishable from a stuck row — which is why the sweep has to ask
    // Stripe at all. Clearing the mark is what stops those rows sitting at the
    // head of the `updated_at ASC` window forever, hiding genuinely stranded
    // freezes behind them and costing a Stripe read on every pass.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_lost',
      status: 'cancelled',
      voidReason: 'dispute',
      frozenByDisputeId: 'dp_lost',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'lost', status: 'lost' }) as never),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(result.freezesUnresolved).toBe(0);
    expect(await freezeAlerts()).toHaveLength(0);

    const after = await readPayout(hold.id);
    // The mark goes; the void stays, so the row is still unpayable by STATUS.
    expect(after?.frozen_by_dispute_id).toBeNull();
    expect(after?.status).toBe('cancelled');
    expect(after?.void_reason).toBe('dispute');
    expect(calls).toHaveLength(0);
  });

  it('reports a LOST dispute whose clawback never ran, instead of clearing it', async () => {
    // `pending` with nothing reversed means the money was never clawed back.
    // Clearing the mark there would hand a lost chargeback to the payout path.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_lost_unsettled',
      frozenByDisputeId: 'dp_lost_unsettled',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'lost', status: 'lost' }) as never),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesUnresolved).toBe(1);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_lost_unsettled');
    expect(calls).toHaveLength(0);
    expect(await freezeAlerts()).toHaveLength(1);
  });

  it('refuses to release a charge that has any refund', async () => {
    // ⚠️ The failure four reviewers found. A chargeback freeze leaves the row
    // `cancelled`, and BOTH clawback selectors skip it (`applyReversalToHolds`
    // takes `pending`, `listReversibleRowsForCharge` takes paid/processing/
    // reversed) — so a refund landing while it is frozen records nothing on it.
    // Releasing would then hand back the FULL amount for a refunded sale, and the
    // step deliberately runs before the paying step, so it would go out at once.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_refunded_won',
      status: 'cancelled',
      voidReason: 'dispute',
      frozenByDisputeId: 'dp_refunded_won',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(
        async () => ({ outcome: 'closed-not-lost', status: 'won' }) as never,
      ),
      retrieveChargeRefundState: vi.fn(async () => ({ amountRefundedCents: 900 })),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(result.freezesUnresolved).toBe(1);
    expect(calls).toHaveLength(0);
    const after = await readPayout(hold.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.frozen_by_dispute_id).toBe('dp_refunded_won');
    expect(await freezeAlerts()).toHaveLength(1);
  });

  it('refuses to release when the charge cannot be read', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_unreadable',
      frozenByDisputeId: 'dp_unreadable',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(
        async () => ({ outcome: 'closed-not-lost', status: 'won' }) as never,
      ),
      retrieveChargeRefundState: vi.fn(async () => null),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(result.freezesUnresolved).toBe(1);
    expect(calls).toHaveLength(0);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_unreadable');
  });

  it('refuses to release while the order is still revoked', async () => {
    // If `charge.dispute.closed` never ran at all, the order is still `disputed`:
    // the sale is out of the photographer's `net` and the buyer is locked out.
    // Paying the hold there breaks the invariant that a hold sits in `pending`
    // exactly while its sale sits in `net`. Restoring access is the webhook's job.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_still_disputed',
      status: 'cancelled',
      voidReason: 'dispute',
      frozenByDisputeId: 'dp_still_disputed',
      orderStatus: 'disputed',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(
        async () => ({ outcome: 'closed-not-lost', status: 'won' }) as never,
      ),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(result.freezesUnresolved).toBe(1);
    expect(calls).toHaveLength(0);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_still_disputed');
  });

  it('leaves an OPEN dispute frozen and raises no alert', async () => {
    // A chargeback legitimately runs for 60-90 days. Age alone is not evidence.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_open',
      frozenByDisputeId: 'dp_open',
    });

    const { deps, calls } = makeDeps();
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(await freezeAlerts()).toHaveLength(0);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_open');
    expect(calls).toHaveLength(0);
  });

  it('never concludes from a failed read: reports and touches nothing', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_unknown',
      frozenByDisputeId: 'dp_unknown',
    });

    const { deps, calls } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'unknown' }) as never),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesReleased).toBe(0);
    expect(result.freezesUnresolved).toBe(1);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_unknown');
    expect(calls).toHaveLength(0);

    const alerts = await freezeAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.[0].context?.rowCount).toBe(1);
    expect(alerts[0]?.[0].context?.oldestPayoutId).toBe(hold.id);
  });

  it('reports a dispute Stripe no longer has, rather than releasing it', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_missing',
      frozenByDisputeId: 'dp_missing',
    });

    const { deps } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'missing' }) as never),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(result.freezesUnresolved).toBe(1);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_missing');
    expect(await freezeAlerts()).toHaveLength(1);
  });

  it('alerts once per day, not once per cron pass', async () => {
    // The cron runs 48x/day and a stuck freeze does not fix itself.
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_repeat',
      frozenByDisputeId: 'dp_repeat',
    });

    const { deps } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'unknown' }) as never),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(await freezeAlerts()).toHaveLength(1);
  });

  it('leaves a freshly frozen hold alone — no Stripe read, no alert', async () => {
    // The staleness window is what stops the sweep racing a `closed` event that
    // is still in flight.
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_fresh_freeze',
      frozenByDisputeId: 'dp_fresh',
    });

    const { deps } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'closed-not-lost' }) as never),
    });
    const result = await runRetryPendingPayoutsFlow(passthroughStep, Date.now(), deps);

    expect(deps.retrieveDisputeOutcome).not.toHaveBeenCalled();
    expect(result.freezesReleased).toBe(0);
    expect(await freezeAlerts()).toHaveLength(0);
    expect((await readPayout(hold.id))?.frozen_by_dispute_id).toBe('dp_fresh');
  });

  it('reads Stripe once per dispute, not once per frozen row', async () => {
    // One dispute freezes every hold on its charge, so a multi-photographer order
    // would otherwise ask Stripe the same question once per photographer.
    const a = await makePhotographer({});
    const b = await makePhotographer({});
    await seedHold({
      photographerId: a.id,
      amountCents: 900,
      chargeId: 'ch_shared',
      frozenByDisputeId: 'dp_shared',
    });
    await seedHold({
      photographerId: b.id,
      amountCents: 800,
      chargeId: 'ch_shared',
      frozenByDisputeId: 'dp_shared',
    });

    const { deps } = makeDeps({
      retrieveDisputeOutcome: vi.fn(async () => ({ outcome: 'lost', status: 'lost' }) as never),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, FREEZE_FUTURE_NOW, deps);

    expect(deps.retrieveDisputeOutcome).toHaveBeenCalledTimes(1);
  });
});

/**
 * T-254: the worker's failure exits deliberately never throw, so a hold whose
 * every retry fails — `createTransfer` throwing on an invalid destination, a
 * probe answering `unknown` forever — was retried every 30 minutes indefinitely
 * with nothing but a console line. These tests pin the sweep that surfaces the
 * STATE: aggregated, once per rolling day, clocked on `created_at` (the
 * `payouts_set_updated_at` trigger re-stamps `updated_at` on every failed
 * attempt), and changing nothing about what the worker pays.
 */
describe('runRetryPendingPayoutsFlow — stuck holds (T-254)', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    stuckSelectorOverrides.listStuckRetryableRows = null;
    stuckSelectorOverrides.listAgedOutstandingHolds = null;
  });

  /** 25 hours ahead: rows seeded "now" clear the 24-hour stuck window. */
  const STUCK_FUTURE_NOW = Date.now() + 25 * 60 * MINUTE_MS;
  /** 31 days ahead: rows seeded "now" clear the 30-day outstanding window. */
  const AGED_FUTURE_NOW = Date.now() + 31 * 24 * 60 * MINUTE_MS;

  async function stuckAlerts() {
    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    return vi
      .mocked(reportMoneyIncident)
      .mock.calls.filter(([incident]) => incident.kind === 'payout-hold-stuck');
  }

  it('reports a transfer_failed hold whose transfer fails on every retry, and leaves it retryable', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_stuck',
      holdReason: 'transfer_failed',
    });

    const { deps } = makeDeps({
      createTransfer: vi.fn(async () => {
        throw new Error('destination account is invalid');
      }),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    const alerts = await stuckAlerts();
    expect(alerts).toHaveLength(1);
    const incident = alerts[0]?.[0];
    expect(incident?.context?.stuckRowCount).toBe(1);
    expect(incident?.context?.agedRowCount).toBe(0);
    expect(String(incident?.context?.payoutIds)).toContain(hold.id);
    expect(incident?.context?.oldestPayoutId).toBe(hold.id);
    // The sweep reports and does not repair: the row is exactly where the
    // normal retry path expects it.
    expect((await readPayout(hold.id))?.status).toBe('pending');
    expect((await readPayout(hold.id))?.hold_reason).toBe('transfer_failed');
  });

  it('does NOT alert on a fresh failure — the alert is about a state, not an attempt', async () => {
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_fresh',
      holdReason: 'transfer_failed',
    });

    const { deps } = makeDeps({
      createTransfer: vi.fn(async () => {
        throw new Error('destination account is invalid');
      }),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, FUTURE_NOW, deps);

    expect(await stuckAlerts()).toHaveLength(0);
  });

  it('still alerts when nothing is payable — the revoked-capability early return', async () => {
    // Connect no longer active: `resolve-payable-holds` filters every hold out
    // and the flow returns early. The report must have run before that.
    const photographer = await makePhotographer({ connectStatus: 'pending' });
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_revoked',
      holdReason: 'transfer_failed',
    });

    const { deps, calls } = makeDeps();
    const result = await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    expect(calls).toHaveLength(0);
    expect(result.holdsStuck).toBe(1);
    const alerts = await stuckAlerts();
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]?.[0]?.context?.payoutIds)).toContain(hold.id);
  });

  it('does NOT report a connect_inactive hold inside the outstanding window', async () => {
    // A day-old connect_inactive hold is a photographer who has not onboarded
    // yet — a legitimate state with its own channel (T-250), not a stuck row.
    const photographer = await makePhotographer({ connectStatus: 'pending' });
    await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_waiting',
      holdReason: 'connect_inactive',
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    expect(await stuckAlerts()).toHaveLength(0);
  });

  it('reports a connect_inactive hold past the 30-day outstanding window', async () => {
    const photographer = await makePhotographer({ connectStatus: 'pending' });
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_aged',
      holdReason: 'connect_inactive',
    });

    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, AGED_FUTURE_NOW, deps);

    const alerts = await stuckAlerts();
    expect(alerts).toHaveLength(1);
    const incident = alerts[0]?.[0];
    expect(incident?.context?.agedRowCount).toBe(1);
    expect(incident?.context?.stuckRowCount).toBe(0);
    expect(String(incident?.context?.payoutIds)).toContain(hold.id);
  });

  it('never reports a frozen row — the dispute sweep owns that state (T-265)', async () => {
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_frozen_stuck',
      holdReason: 'transfer_failed',
      frozenByDisputeId: 'dp_open_long',
    });

    // Default dispute outcome is 'open': the freeze sweep leaves it alone too.
    const { deps } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    expect(await stuckAlerts()).toHaveLength(0);
  });

  it('reports a processing row wedged by a perpetually inconclusive probe', async () => {
    const photographer = await makePhotographer({});
    const hold = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_limbo',
      holdReason: 'transfer_failed',
      status: 'processing',
      transferBatchId: null,
    });

    const { deps } = makeDeps({
      findTransferByGroup: vi.fn(async () => ({ outcome: 'unknown' }) as never),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    const alerts = await stuckAlerts();
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]?.[0]?.context?.payoutIds)).toContain(hold.id);
    // Left in limbo for the recovery step, exactly as before.
    expect((await readPayout(hold.id))?.status).toBe('processing');
  });

  it('alerts that the CHECK is down when the ledger cannot be read, and still pays', async () => {
    // The watchdog's own failure mode: the catch keeps the paying steps alive,
    // which makes the step SUCCEED — so without this alert a wedged query
    // (statement timeout, schema-cache blip) would silence the sweep forever
    // with nothing red in Inngest either.
    const photographer = await makePhotographer({});
    const payable = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_still_paid',
      holdReason: 'connect_inactive',
    });
    stuckSelectorOverrides.listStuckRetryableRows = () => {
      throw new Error('canceling statement due to statement timeout');
    };

    const { deps, calls } = makeDeps();
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    const { reportMoneyIncident } = await import('@/lib/observability/report-money-incident');
    const failureAlerts = vi
      .mocked(reportMoneyIncident)
      .mock.calls.filter(([incident]) => incident.kind === 'payout-hold-sweep-failed');
    expect(failureAlerts).toHaveLength(1);
    // No row-level claim about a set it could not read.
    expect(await stuckAlerts()).toHaveLength(0);
    // ⚠️ The whole reason the read error is swallowed: the money still moves.
    expect(calls).toHaveLength(1);
    expect((await readPayout(payable.id))?.status).toBe('paid');
  });

  it('says so when more rows matched than the pass lists', async () => {
    // A silently capped count reads as "this is everything", which is exactly
    // how a mass failure looks small. Synthetic rows: seeding 501 is minutes of
    // inserts to exercise one branch.
    const photographer = await makePhotographer({});
    const seeded = await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_overflow',
      holdReason: 'transfer_failed',
    });
    stuckSelectorOverrides.listStuckRetryableRows = async () =>
      Array.from({ length: 501 }, (_, i) => ({ ...seeded, id: `${i}-${seeded.id}` }));

    const { deps } = makeDeps({
      createTransfer: vi.fn(async () => {
        throw new Error('destination account is invalid');
      }),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    const alerts = await stuckAlerts();
    expect(alerts).toHaveLength(1);
    const incident = alerts[0]?.[0];
    expect(incident?.context?.countsTruncatedAtRows).toBe(500);
    expect(incident?.context?.stuckRowCount).toBe(500);
    expect(incident?.message).toContain('At least');
  });

  it('alerts once per rolling day, not once per cron pass', async () => {
    const photographer = await makePhotographer({});
    await seedHold({
      photographerId: photographer.id,
      amountCents: 900,
      chargeId: 'ch_daily',
      holdReason: 'transfer_failed',
    });

    const { deps } = makeDeps({
      createTransfer: vi.fn(async () => {
        throw new Error('destination account is invalid');
      }),
    });
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);
    await runRetryPendingPayoutsFlow(passthroughStep, STUCK_FUTURE_NOW, deps);

    expect(await stuckAlerts()).toHaveLength(1);
  });
});
