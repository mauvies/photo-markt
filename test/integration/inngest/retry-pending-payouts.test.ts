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

const MINUTE_MS = 60 * 1000;
/** An hour ahead makes anything written "now" older than the 30-minute window. */
const FUTURE_NOW = Date.now() + 60 * MINUTE_MS;

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
}) {
  const sb = createServiceClient();
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
    .select('status, amount_cents, stripe_transfer_id, hold_reason, transfer_batch_id')
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
