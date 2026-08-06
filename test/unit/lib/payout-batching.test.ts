/**
 * Unit tests for the payout batching rules (`src/lib/payouts/batching.ts`, T-216).
 *
 * These encode the decision that only sub-minimum rows get aggregated. Everything
 * else is transferred individually so it can keep `source_transaction`, which is
 * both the funding guarantee and a double-pay guard that outlives Stripe's
 * 24-hour idempotency window.
 */

import { describe, expect, it } from 'vitest';
import {
  batchTransferGroup,
  type PayableRow,
  payoutIdempotencyKey,
  payoutTransferGroup,
  STRIPE_MIN_TRANSFER_CENTS,
  splitPayableRows,
} from '@/lib/payouts/batching';

function row(overrides: Partial<PayableRow> & { id: string }): PayableRow {
  return {
    photographer_id: 'photog-1',
    amount_cents: 100,
    currency: 'eur',
    stripe_charge_id: `ch_${overrides.id}`,
    hold_reason: 'connect_inactive',
    ...overrides,
  };
}

describe('splitPayableRows', () => {
  it('sends a row that clears the minimum on its own individually', () => {
    const split = splitPayableRows([row({ id: 'a', amount_cents: 500 })]);

    expect(split.individual.map((r) => r.id)).toEqual(['a']);
    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toEqual([]);
  });

  it('treats a row exactly at the minimum as individually payable', () => {
    // Stripe's floor is inclusive: 50 cents is transferable, 49 is not.
    const split = splitPayableRows([row({ id: 'a', amount_cents: STRIPE_MIN_TRANSFER_CENTS })]);

    expect(split.individual).toHaveLength(1);
    expect(split.aggregates).toEqual([]);
  });

  it('accumulates two sub-minimum rows that together clear the minimum', () => {
    // The ticket's headline case: two 30-cent nets are individually unsendable
    // but 60 cents is one transfer.
    const split = splitPayableRows([
      row({ id: 'a', amount_cents: 30 }),
      row({ id: 'b', amount_cents: 30 }),
    ]);

    expect(split.individual).toEqual([]);
    expect(split.aggregates).toHaveLength(1);
    expect(split.aggregates[0]?.totalCents).toBe(60);
    expect(split.aggregates[0]?.rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(split.belowMinimum).toEqual([]);
  });

  it('leaves a group still short of the minimum outstanding', () => {
    const split = splitPayableRows([
      row({ id: 'a', amount_cents: 10 }),
      row({ id: 'b', amount_cents: 15 }),
    ]);

    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toHaveLength(1);
    expect(split.belowMinimum[0]?.totalCents).toBe(25);
  });

  it('never merges two currencies into one batch', () => {
    // A transfer carries exactly one currency, and a pre-T-193 order settled in
    // USD. Merging would build a transfer Stripe rejects — or worse, accepts at
    // the wrong value.
    const split = splitPayableRows([
      row({ id: 'a', amount_cents: 40, currency: 'eur' }),
      row({ id: 'b', amount_cents: 40, currency: 'usd' }),
    ]);

    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toHaveLength(2);
    expect(split.belowMinimum.map((g) => g.currency).sort()).toEqual(['eur', 'usd']);
  });

  it('never merges two photographers into one batch', () => {
    const split = splitPayableRows([
      row({ id: 'a', amount_cents: 40, photographer_id: 'photog-1' }),
      row({ id: 'b', amount_cents: 40, photographer_id: 'photog-2' }),
    ]);

    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toHaveLength(2);
  });

  it('groups per (photographer, currency) across a mixed set', () => {
    const split = splitPayableRows([
      row({ id: 'big', amount_cents: 900 }),
      row({ id: 'a', amount_cents: 30, photographer_id: 'p1', currency: 'eur' }),
      row({ id: 'b', amount_cents: 30, photographer_id: 'p1', currency: 'eur' }),
      row({ id: 'c', amount_cents: 20, photographer_id: 'p2', currency: 'eur' }),
    ]);

    expect(split.individual.map((r) => r.id)).toEqual(['big']);
    expect(split.aggregates).toHaveLength(1);
    expect(split.aggregates[0]?.photographerId).toBe('p1');
    expect(split.belowMinimum).toHaveLength(1);
    expect(split.belowMinimum[0]?.photographerId).toBe('p2');
  });

  it('skips a row with no currency instead of guessing one', () => {
    // Fails closed: the currency of money is not something to default.
    const split = splitPayableRows([row({ id: 'a', amount_cents: 500, currency: null })]);

    expect(split.individual).toEqual([]);
    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toEqual([]);
  });

  it('skips non-positive amounts', () => {
    const split = splitPayableRows([
      row({ id: 'zero', amount_cents: 0 }),
      row({ id: 'neg', amount_cents: -100 }),
    ]);

    expect(split.individual).toEqual([]);
    expect(split.aggregates).toEqual([]);
    expect(split.belowMinimum).toEqual([]);
  });

  it('returns nothing for an empty input', () => {
    expect(splitPayableRows([])).toEqual({
      individual: [],
      aggregates: [],
      belowMinimum: [],
    });
  });
});

describe('idempotency keys', () => {
  it('derives the per-row key from the payout id', () => {
    // The key must be a pure function of durable state: the webhook and the
    // retry worker compute it independently and must agree, or Stripe cannot
    // dedupe between them.
    expect(payoutIdempotencyKey('abc')).toBe('payout_abc');
  });

  it('derives the per-row transfer group from the payout id too', () => {
    // ⚠️ Regression. Stripe compares the WHOLE request body against the one
    // stored under an idempotency key and 400s on any divergence, so a shared
    // key with a per-writer `transfer_group` dedupes nothing. The webhook used
    // to send `transfer_group = orderId` while the worker sent a payout-derived
    // group under the same key: every `transfer_failed` hold — the only reason
    // created AFTER a Stripe call — then 400'd on every retry for 24h, and once
    // the key expired the retry issued a real second transfer.
    //
    // Both writers must derive it from the payout id and nothing else.
    expect(payoutTransferGroup('abc')).toBe('payout_abc');
    expect(payoutTransferGroup('abc')).not.toContain('order');
  });

  it('uses one string for a batch as both idempotency key and transfer group', () => {
    // transfer_group is the only server-side filter transfers.list offers, so it
    // is what lets a re-drive find a transfer whose key has since expired.
    expect(batchTransferGroup('batch-1')).toBe('payout_batch_batch-1');
  });
});
