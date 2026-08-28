/**
 * Cron + on-demand worker: pay the photographer earnings that could not be sent
 * when the sale completed (T-216).
 *
 * Before this existed, `createTransfersForOrderItems` had three exits that did
 * nothing but `console.warn` — an inactive Connect account, a net below Stripe's
 * 50-cent transfer minimum, and a transfer that threw. The money stayed in the
 * platform balance, no row recorded the debt, and nothing ever retried. A
 * photographer who sold and *then* finished Connect onboarding never got paid.
 *
 * The webhook now records each of those as a `pending` payout row carrying its
 * charge, currency and `hold_reason`. This worker drains them.
 *
 * ## Why the money is never paid twice
 *
 * The payout row is created BEFORE any Stripe call and **its id is the
 * idempotency key** (`payout_<id>`) — the same key the webhook uses, so the two
 * writers dedupe against each other rather than living in separate namespaces.
 * On top of that, every individually-payable row keeps `source_transaction`
 * pointed at its charge, and Stripe refuses a transfer that would over-draw a
 * charge — a guard that, unlike a 24-hour idempotency key, never expires.
 *
 * ## Why only sub-minimum rows are batched
 *
 * A transfer carries at most one source charge, so aggregating across charges
 * forces `source_transaction` to be dropped and the transfer then draws on the
 * platform's *available* balance (swept to the bank on a schedule, card funds
 * pending for days). We accept that only where there is no alternative: a
 * 30-cent net can never clear a 50-cent floor on its own. Everything else pays
 * individually. See `src/lib/payouts/batching.ts`.
 *
 * Why Inngest (not pg_cron): Supabase Free has no pg_cron; Inngest is already in
 * the stack with cron triggers on its free plan. No new infra.
 */

import {
  claimPayoutForTransfer,
  claimPayoutsForBatch,
  holdPayoutRow,
  listPayableHolds,
  listStaleProcessingBatches,
  listStaleProcessingSingles,
  type Payout,
  releaseClaimedPayouts,
  settleBatchAsPaid,
  settlePayoutPaid,
} from '@/database/queries/payouts';
import { getPhotographerConnectStatuses } from '@/database/queries/profiles';
import type { SupabaseServerClient } from '@/database/queries/types';
import { supabaseAdmin } from '@/database/supabase-admin';
import {
  batchTransferGroup,
  type PayableRow,
  payoutIdempotencyKey,
  payoutTransferGroup,
  STRIPE_MIN_TRANSFER_CENTS,
  splitPayableRows,
} from '@/lib/payouts/batching';
import {
  createTransfer,
  findTransferByGroup,
  reconcileAndPersistConnectStatus,
} from '@/lib/stripe/connect';
import { inngest } from '../client';
import type { InngestStepRunner } from '../step';

const adminClient = supabaseAdmin as unknown as SupabaseServerClient;

/** Bound each tick. Generous headroom at current scale; a safety valve otherwise. */
const MAX_HOLDS_PER_TICK = 500;
/**
 * A ROW cap, not a batch cap — a batch straddling it would be recovered against
 * a partial total, so it is set far above any realistic batch size. (Sub-minimum
 * holds are close to unreachable in practice: `MIN_PHOTO_PRICE_CENTS` is 150 and
 * bundles allocate per (event, photographer), so a per-photographer net is
 * comfortably over the 50-cent floor.)
 */
const MAX_STALE_ROWS_PER_TICK = 500;

/**
 * How long a row may sit `processing` before we treat its batch as abandoned and
 * re-drive it. Long enough that a run still in progress is never clobbered.
 */
const STALE_BATCH_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface RetryPayoutsResult {
  transfersCreated: number;
  rowsPaid: number;
  centsPaid: number;
  /** Groups still short of the Stripe minimum — left outstanding on purpose. */
  groupsBelowMinimum: number;
  /** Photographers skipped because Connect still isn't active. */
  photographersNotActive: number;
  /** Stale batches recovered from an existing Stripe transfer instead of re-sent. */
  batchesRecovered: number;
  releasedClaims: number;
}

/** Injected so the integration test can drive the flow without Stripe. */
export interface RetryPayoutsDeps {
  createTransfer: typeof createTransfer;
  findTransferByGroup: typeof findTransferByGroup;
  reconcileAndPersistConnectStatus: typeof reconcileAndPersistConnectStatus;
}

const defaultDeps: RetryPayoutsDeps = {
  createTransfer,
  findTransferByGroup,
  reconcileAndPersistConnectStatus,
};

export const retryPendingPayouts = inngest.createFunction(
  {
    id: 'retry-pending-payouts',
    // ⚠️ ONE function with BOTH triggers, not two registrations. Inngest scopes
    // `concurrency` per function id, so registering the cron and the event
    // handler separately would give them independent limits and allow genuinely
    // concurrent runs for the same photographer.
    concurrency: { limit: 1 },
    // Stripe emits `account.updated` in bursts as capabilities flip, so an
    // activation can fire several events within seconds. Collapse them.
    debounce: { key: 'event.data.photographerId', period: '60s' },
    // 10 and 40 past the hour — a free slot between cleanup-orphaned-storage
    // (0,30) and reconcile-indexing (15,45), so the three crons don't contend.
    triggers: [{ cron: '10,40 * * * *' }, { event: 'payouts.retry-requested' }],
  },
  async ({ step }: { step: InngestStepRunner }) => {
    return await runRetryPendingPayoutsFlow(step, Date.now());
  },
);

/** A payout row is a `PayableRow` plus the fields only the DB layer needs. */
/**
 * Project a ledger row into what the batching maths needs.
 *
 * ⚠️ `amount_cents` is the amount the sale ORIGINALLY owed; what is still payable
 * is `amount_cents - reversed_amount_cents` (T-215). The column is immutable so
 * that a partial clawback is idempotent under Stripe redelivery and so the
 * recovery probe can still recognise a transfer made at the original amount — the
 * price of that is that every consumer must subtract, here and at the two sites
 * below that read raw rows.
 */
function toPayableRow(row: Payout): PayableRow {
  return {
    id: row.id,
    photographer_id: row.photographer_id,
    amount_cents: payableCents(row),
    currency: row.currency,
    stripe_charge_id: row.stripe_charge_id,
    hold_reason: row.hold_reason,
  };
}

/** What is still owed on a row after any clawback. */
function payableCents(row: Pick<Payout, 'amount_cents' | 'reversed_amount_cents'>): number {
  return Math.max(0, row.amount_cents - (row.reversed_amount_cents ?? 0));
}

/**
 * Pure handler body, exported for the integration test (which passes a
 * pass-through fake step, an explicit `nowMs` so the staleness window is
 * deterministic, and stubbed Stripe deps).
 */
export async function runRetryPendingPayoutsFlow(
  step: InngestStepRunner,
  nowMs: number,
  deps: RetryPayoutsDeps = defaultDeps,
): Promise<RetryPayoutsResult> {
  const result: RetryPayoutsResult = {
    transfersCreated: 0,
    rowsPaid: 0,
    centsPaid: 0,
    groupsBelowMinimum: 0,
    photographersNotActive: 0,
    batchesRecovered: 0,
    releasedClaims: 0,
  };

  // ── 0. Recover batches abandoned mid-flight ──────────────────────────────
  // Must run BEFORE new work: a stale batch's rows are `processing`, so they are
  // invisible to the sweep below and would otherwise never be paid.
  const staleBefore = new Date(nowMs - STALE_BATCH_AGE_MS).toISOString();
  await step.run('recover-stale-batches', async () => {
    const staleRows = await listStaleProcessingBatches(
      adminClient,
      staleBefore,
      MAX_STALE_ROWS_PER_TICK,
    );

    const batches = new Map<string, Payout[]>();
    for (const row of staleRows) {
      if (!row.transfer_batch_id) continue;
      const existing = batches.get(row.transfer_batch_id);
      if (existing) existing.push(row);
      else batches.set(row.transfer_batch_id, [row]);
    }

    for (const [batchId, rows] of batches) {
      const photographerId = rows[0]?.photographer_id;
      if (!photographerId) continue;

      const [connect] = await getPhotographerConnectStatuses(adminClient, [photographerId]);
      const destination = connect?.stripe_connect_account_id;
      if (!destination) continue;

      const totalCents = rows.reduce((sum, row) => sum + payableCents(row), 0);
      const probe = await deps.findTransferByGroup({
        transferGroup: batchTransferGroup(batchId),
        destination,
        amountCents: totalCents,
      });

      if (probe.outcome === 'found') {
        // Stripe already moved this money — the previous run died between the
        // transfer and the settle. Record it; do NOT transfer again.
        await settleBatchAsPaid(adminClient, batchId, probe.transfer.id);
        result.batchesRecovered += 1;
        result.rowsPaid += rows.length;
        result.centsPaid += totalCents;
        console.log(
          `[retry-payouts] batch ${batchId} recovered from transfer ${probe.transfer.id}`,
        );
        continue;
      }

      if (probe.outcome === 'unknown') {
        // A Stripe read blip must never be read as "nothing was sent" — that is
        // exactly how a probe turns into a double payment. Leave the batch for
        // the next tick.
        console.warn(`[retry-payouts] batch ${batchId}: transfer lookup inconclusive, skipping`);
        continue;
      }

      // Nothing was sent. Re-drive under the SAME batch id, so the idempotency
      // key is unchanged and a transfer we simply failed to observe is returned
      // rather than duplicated.
      try {
        const transfer = await deps.createTransfer({
          amountCents: totalCents,
          currency: rows[0]?.currency ?? '',
          destination,
          transferGroup: batchTransferGroup(batchId),
          idempotencyKey: batchTransferGroup(batchId),
        });
        await settleBatchAsPaid(adminClient, batchId, transfer.id);
        result.transfersCreated += 1;
        result.rowsPaid += rows.length;
        result.centsPaid += totalCents;
      } catch (err) {
        console.error(`[retry-payouts] re-drive of batch ${batchId} failed:`, err);
      }
    }

    return { batches: batches.size };
  });

  // ── 0b. Recover individually-claimed rows abandoned mid-flight ───────────
  // The mirror of the step above for rows claimed by `claimPayoutForTransfer`
  // (no batch id). Without it, claiming would swap a double-payment window for a
  // permanent stranding: a `processing` row is invisible to `listPayableHolds`.
  await step.run('recover-stale-singles', async () => {
    const staleRows = await listStaleProcessingSingles(
      adminClient,
      staleBefore,
      MAX_STALE_ROWS_PER_TICK,
    );

    for (const row of staleRows) {
      const [connect] = await getPhotographerConnectStatuses(adminClient, [row.photographer_id]);
      const destination = connect?.stripe_connect_account_id;
      if (!destination) continue;

      // The ORIGINAL amount, like every other probe: that is what the transfer
      // would have been made for and what the idempotency key describes.
      const probe = await deps.findTransferByGroup({
        transferGroup: payoutTransferGroup(row.id),
        destination,
        amountCents: row.amount_cents,
      });

      if (probe.outcome === 'found') {
        await settlePayoutPaid(adminClient, row.id, probe.transfer.id);
        result.rowsPaid += 1;
        result.centsPaid += payableCents(row);
        console.log(
          `[retry-payouts] payout ${row.id} recovered from transfer ${probe.transfer.id}`,
        );
        continue;
      }

      if (probe.outcome === 'unknown') {
        // A read blip is never "nothing was sent". Leave it claimed for next tick.
        console.warn(`[retry-payouts] payout ${row.id}: stale-claim lookup inconclusive`);
        continue;
      }

      // Provably nothing was sent, so hand the claim back for the normal path.
      await holdPayoutRow(adminClient, row.id, 'transfer_failed');
      result.releasedClaims += 1;
    }

    return { recovered: staleRows.length };
  });

  // ── 1. Load outstanding holds and resolve who can be paid ────────────────
  const { payableRows, notActive } = await step.run('resolve-payable-holds', async () => {
    const holds = await listPayableHolds(adminClient, MAX_HOLDS_PER_TICK);
    if (holds.length === 0) return { payableRows: [] as Payout[], notActive: 0 };

    const photographerIds = [...new Set(holds.map((h) => h.photographer_id))];
    const connectStatuses = await getPhotographerConnectStatuses(adminClient, photographerIds);

    const active = new Map<string, string>();
    let notActive = 0;
    for (const status of connectStatuses) {
      // Same live-reconcile the webhook uses: a stale `pending` cached value for
      // an account Stripe already enabled must not keep money stranded.
      const effective = await deps.reconcileAndPersistConnectStatus({
        client: adminClient,
        userId: status.id,
        accountId: status.stripe_connect_account_id,
        storedStatus: status.stripe_connect_status,
      });
      if (effective === 'active' && status.stripe_connect_account_id) {
        active.set(status.id, status.stripe_connect_account_id);
      } else {
        notActive += 1;
      }
    }

    return {
      payableRows: holds.filter((h) => active.has(h.photographer_id)),
      notActive,
    };
  });

  result.photographersNotActive = notActive;
  if (payableRows.length === 0) return result;

  const destinations = await step.run('resolve-destinations', async () => {
    const ids = [...new Set(payableRows.map((r) => r.photographer_id))];
    const statuses = await getPhotographerConnectStatuses(adminClient, ids);
    return Object.fromEntries(
      statuses
        .filter((s) => s.stripe_connect_account_id)
        .map((s) => [s.id, s.stripe_connect_account_id as string]),
    );
  });

  const split = splitPayableRows(payableRows.map(toPayableRow));
  result.groupsBelowMinimum = split.belowMinimum.length;
  for (const group of split.belowMinimum) {
    console.log(
      `[retry-payouts] photographer ${group.photographerId} holds ${group.totalCents} ${group.currency} cents — below the ${STRIPE_MIN_TRANSFER_CENTS}-cent minimum, accumulating.`,
    );
  }

  // ── 2. Rows that clear the minimum alone → individual transfers ──────────
  for (const row of split.individual) {
    const destination = destinations[row.photographer_id];
    if (!destination || !row.currency || !row.stripe_charge_id) continue;

    await step.run(`transfer-payout-${row.id}`, async () => {
      // A `transfer_failed` row is the only one whose idempotency key may already
      // have been used: the webhook issued a transfer and never saw the response.
      // Within 24h the key replays Stripe's original answer, but after that it
      // expires and a blind re-drive would create a SECOND transfer.
      // `source_transaction` is a partial backstop — Stripe refuses to over-draw
      // the charge — but on a multi-photographer order one share can still fit in
      // the charge's remaining headroom. So probe first, exactly as the batch
      // path does.
      if (row.hold_reason === 'transfer_failed') {
        // ⚠️ `row.amount_cents` here is the PAYABLE amount, and the probe must
        // match the ORIGINAL — that is what the spent idempotency key describes.
        // The two only diverge when a clawback partially reduced this row, and
        // `applyReversalToHolds` voids such rows precisely because neither the
        // key nor the probe can express the new amount. Rows that reach here are
        // therefore un-clawed-back, and the guard in `resolve-payable-holds`
        // keeps it that way.
        const probe = await deps.findTransferByGroup({
          transferGroup: payoutTransferGroup(row.id),
          destination,
          amountCents: row.amount_cents,
        });

        if (probe.outcome === 'found') {
          await settlePayoutPaid(adminClient, row.id, probe.transfer.id);
          result.rowsPaid += 1;
          result.centsPaid += row.amount_cents;
          console.log(
            `[retry-payouts] payout ${row.id} recovered from existing transfer ${probe.transfer.id}`,
          );
          return null;
        }

        if (probe.outcome === 'unknown') {
          // Fail closed: a Stripe read blip must never be read as "nothing was
          // sent". The row stays pending for the next tick.
          console.warn(`[retry-payouts] payout ${row.id}: transfer lookup inconclusive, skipping`);
          return null;
        }
      }

      // ⚠️ Claim BEFORE calling Stripe, exactly as the batch path does. Leaving the
      // row `pending` across its own transfer meant a run that paid and then failed
      // to record it left a paid row looking unpaid — hidden for 24h by the
      // idempotency key, and paid a second time on the first tick after the key
      // expired. A row we cannot claim is one somebody else is already handling.
      const claimed = await claimPayoutForTransfer(adminClient, row.id);
      if (!claimed) {
        console.log(`[retry-payouts] payout ${row.id} was claimed elsewhere, skipping`);
        return null;
      }

      try {
        const transfer = await deps.createTransfer({
          amountCents: row.amount_cents,
          currency: row.currency as string,
          destination,
          // Kept deliberately: ties the transfer to its charge's funds and lets
          // Stripe itself refuse an over-draw, which outlives the idempotency key.
          sourceTransaction: row.stripe_charge_id as string,
          // ⚠️ Must be byte-identical to what the webhook sends for this row —
          // Stripe rejects a reused key whose parameters differ, which would
          // wedge every `transfer_failed` retry for the key's whole lifetime.
          transferGroup: payoutTransferGroup(row.id),
          idempotencyKey: payoutIdempotencyKey(row.id),
        });
        await settlePayoutPaid(adminClient, row.id, transfer.id);
        result.transfersCreated += 1;
        result.rowsPaid += 1;
        result.centsPaid += row.amount_cents;
        console.log(
          `[retry-payouts] paid ${row.amount_cents} cents to photographer ${row.photographer_id} (payout ${row.id})`,
        );
      } catch (err) {
        console.error(`[retry-payouts] transfer for payout ${row.id} failed:`, err);
        // Hand the claim back so the next tick can retry — and hand it back as
        // `transfer_failed`, which is the truth: the call was made and we never saw
        // its answer. That reason is what makes the next tick PROBE before
        // re-driving, instead of blindly re-sending money Stripe may already have
        // moved. Leaving the row `processing` would strand it until the stale
        // sweep, which is slower for no gain.
        await holdPayoutRow(adminClient, row.id, 'transfer_failed').catch((holdErr) =>
          console.error(`[retry-payouts] failed to release claim on payout ${row.id}:`, holdErr),
        );
      }
      return null;
    });
  }

  // ── 3. Sub-minimum leftovers → one aggregated, source-less transfer ──────
  for (const group of split.aggregates) {
    const destination = destinations[group.photographerId];
    if (!destination) continue;

    await step.run(`transfer-batch-${group.photographerId}-${group.currency}`, async () => {
      // The batch id is generated here and read back from the claim's RETURNING
      // — never held in a variable across a step boundary. An Inngest replay
      // that minted a fresh uuid would produce a fresh idempotency key and
      // re-transfer rows already in flight.
      const batchId = crypto.randomUUID();
      const claimed = await claimPayoutsForBatch(
        adminClient,
        group.rows.map((r) => r.id),
        batchId,
      );
      if (claimed.length === 0) return null;

      // ⚠️ Recompute from what we ACTUALLY claimed. A concurrent run may have
      // taken part of the group, and transferring the pre-claim total would send
      // money for rows we don't own.
      const claimedCents = claimed.reduce((sum, row) => sum + payableCents(row), 0);

      if (claimedCents < STRIPE_MIN_TRANSFER_CENTS) {
        // Stripe would reject this and cache the error under the batch key for
        // 24 hours; with the rows stuck `processing` they'd be excluded from
        // every future batch — wedged for good. Releasing is safe precisely
        // because no Stripe call was issued against this claim.
        await releaseClaimedPayouts(adminClient, batchId, 'below_minimum');
        result.releasedClaims += 1;
        result.groupsBelowMinimum += 1;
        return null;
      }

      try {
        const transfer = await deps.createTransfer({
          amountCents: claimedCents,
          currency: group.currency,
          destination,
          // No `sourceTransaction`: a batch spans several charges and Stripe
          // permits at most one. This is the only path that draws on the
          // platform balance, which is why it carries only sub-50-cent rows.
          transferGroup: batchTransferGroup(batchId),
          idempotencyKey: batchTransferGroup(batchId),
        });
        await settleBatchAsPaid(adminClient, batchId, transfer.id);
        result.transfersCreated += 1;
        result.rowsPaid += claimed.length;
        result.centsPaid += claimedCents;
        console.log(
          `[retry-payouts] batch ${batchId}: paid ${claimedCents} cents across ${claimed.length} rows to photographer ${group.photographerId}`,
        );
      } catch (err) {
        // Leave the rows `processing`. The stale-batch recovery above re-drives
        // them under this same batch id, probing Stripe first — never a release,
        // because a transfer may have been created despite the throw.
        console.error(`[retry-payouts] batch ${batchId} transfer failed:`, err);
      }
      return null;
    });
  }

  return result;
}
