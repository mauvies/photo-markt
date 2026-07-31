/**
 * Plan-tier limit enforcement.
 *
 * `lib/plans.ts` declares per-tier ceilings (maxEvents, storageGB) but the
 * codebase historically didn't read them — so Free users could create
 * unlimited events and upload until Supabase Storage filled up. These
 * helpers close that gap with a typed error channel that the UI can
 * distinguish from generic server-action failures and turn into an
 * upgrade CTA.
 */

import { getEventsCreatedCount } from '@/database/queries/events';
import { getStorageUsageBytes } from '@/database/queries/photos';
import { getCurrentPlan } from '@/database/queries/subscriptions';
import type { SupabaseServerClient } from '@/database/queries/types';
import { getPlanById, type PlanId } from '@/lib/plans';

const BYTES_PER_GB = 1024 ** 3;

export type PlanLimitType = 'maxEvents' | 'storage';

/**
 * Stable, parseable prefix on `PlanLimitError.message` so a client receiving
 * the error across the server-action boundary can detect it from the message
 * alone — React's serialization preserves `.message` but not custom `.name`
 * or extra fields in production.
 */
const PLAN_LIMIT_MESSAGE_PREFIX = 'PLAN_LIMIT:';

export class PlanLimitError extends Error {
  readonly limitType: PlanLimitType;
  readonly current: number;
  readonly max: number;
  readonly planId: PlanId;

  constructor(args: {
    limitType: PlanLimitType;
    current: number;
    max: number;
    planId: PlanId;
  }) {
    super(`${PLAN_LIMIT_MESSAGE_PREFIX}${args.limitType}`);
    this.name = 'PlanLimitError';
    this.limitType = args.limitType;
    this.current = args.current;
    this.max = args.max;
    this.planId = args.planId;
  }
}

/**
 * Type guard. Works on the server where we still have the class instance,
 * AND on the client where errors have been reduced to plain Error with just
 * `.message` intact. The prefix scheme means we can detect plan-limit
 * failures from client code without relying on custom-error-name preservation.
 */
export function isPlanLimitError(err: unknown): err is PlanLimitError {
  if (!(err instanceof Error)) return false;
  if (err.name === 'PlanLimitError') return true;
  return err.message.startsWith(PLAN_LIMIT_MESSAGE_PREFIX);
}

/**
 * Parse the `limitType` from a (possibly serialized) PlanLimitError. Returns
 * null if the error isn't a plan-limit error.
 */
export function getPlanLimitType(err: unknown): PlanLimitType | null {
  if (!(err instanceof Error)) return null;
  if (err.name === 'PlanLimitError' && 'limitType' in err) {
    return (err as PlanLimitError).limitType;
  }
  if (!err.message.startsWith(PLAN_LIMIT_MESSAGE_PREFIX)) return null;
  const raw = err.message.slice(PLAN_LIMIT_MESSAGE_PREFIX.length);
  return raw === 'maxEvents' || raw === 'storage' ? raw : null;
}

/**
 * Throws `PlanLimitError` if the user is already at their plan's event
 * ceiling. Soft-deleted events do not count (`getEventsCreatedCount`
 * filters `deleted_at IS NULL`). Pro users have `maxEvents === null` →
 * always passes.
 */
export async function assertCanCreateEvent(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<void> {
  const plan = await getCurrentPlan(supabase, userId);
  if (plan.maxEvents === null) return;

  const count = await getEventsCreatedCount(supabase, userId);
  if (count >= plan.maxEvents) {
    throw new PlanLimitError({
      limitType: 'maxEvents',
      current: count,
      max: plan.maxEvents,
      planId: plan.id,
    });
  }
}

/**
 * Throws `PlanLimitError` if adding `fileSizeBytes` would push the user
 * over their plan's storage cap. Callers in batch loops should pre-compute
 * `currentUsageBytes` once via `getStorageUsageBytes` and pass it on every
 * call (and increment it locally after each successful upload) so we don't
 * re-query for every file.
 */
export async function assertCanUploadPhoto(
  supabase: SupabaseServerClient,
  userId: string,
  fileSizeBytes: number,
  currentUsageBytes?: number,
): Promise<void> {
  const plan = await getCurrentPlan(supabase, userId);
  if (plan.storageGB === null) return;

  const current = currentUsageBytes ?? (await getStorageUsageBytes(supabase, userId));
  const max = plan.storageGB * BYTES_PER_GB;

  if (current + fileSizeBytes > max) {
    throw new PlanLimitError({
      limitType: 'storage',
      current,
      max,
      planId: plan.id,
    });
  }
}

export interface FreePlanOverage {
  storage: boolean;
  events: boolean;
}

/**
 * Which Free-plan limits does this usage already exceed? (T-214)
 *
 * Used to decide whether the cancellation confirmation must disclose that
 * dropping to Free will BLOCK further uploads / event creation. It never means
 * anything is deleted: Free's limits are enforced only by the write gates
 * above (`assertCanUploadPhoto` / `assertCanCreateEvent`), so an over-limit
 * photographer keeps everything and is simply unable to add more.
 *
 * Limits are read from `PLANS` rather than hardcoded so the warning can't go
 * stale when Free's caps change. Exactly AT a limit is not over it — the same
 * boundary the write gates use (`count >= max` blocks the *next* one, and a
 * photographer sitting on the line can still keep what they have). A plan with
 * a `null` cap (unlimited) can never be exceeded.
 */
export function getFreePlanOverage(usage: {
  storageUsedGB: number;
  eventsCount: number;
}): FreePlanOverage {
  const free = getPlanById('free');
  return {
    storage: free?.storageGB != null && usage.storageUsedGB > free.storageGB,
    events: free?.maxEvents != null && usage.eventsCount > free.maxEvents,
  };
}

export interface UsageStats {
  eventsCount: number;
  eventsLimit: number | null;
  storageUsedBytes: number;
  storageLimitBytes: number | null;
  planId: PlanId;
}

/**
 * Aggregate snapshot of both limits for the dashboard meter. Used by
 * `getCachedDashboardData` and any UI surface that needs a single read.
 */
export async function getUsageStats(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<UsageStats> {
  const plan = await getCurrentPlan(supabase, userId);
  const [eventsCount, storageUsedBytes] = await Promise.all([
    getEventsCreatedCount(supabase, userId),
    getStorageUsageBytes(supabase, userId),
  ]);

  return {
    eventsCount,
    eventsLimit: plan.maxEvents,
    storageUsedBytes,
    storageLimitBytes: plan.storageGB === null ? null : plan.storageGB * BYTES_PER_GB,
    planId: plan.id,
  };
}
