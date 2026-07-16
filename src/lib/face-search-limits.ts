/**
 * Configuration + pure helpers for the anonymous face-search abuse/cost
 * controls (T-034).
 *
 * `searchFacesInEvent` is the only anonymous path to AWS Rekognition
 * `SearchFacesByImage`, which is billed per call with no AWS-side spend
 * ceiling. Three atomic Postgres counters gate it:
 *   - Tier 1: per-(event, IP) / hour request throttle (existing `rateLimit`).
 *   - Tier 2: per-event / day cost cap (this module's `eventDailyKey`).
 *   - Tier 3: global / day circuit breaker (`globalDailyKey`).
 *
 * The cost tiers count REAL billable AWS calls, not raw searches — see
 * `AWS_CALLS_PER_FACE_SEARCH`. Caps are env-configurable (never hardcoded);
 * defaults are deliberately low because legitimate traffic today is ≈ 0.
 *
 * Everything here is pure and importable without a DB so the enforcement
 * logic is unit-testable.
 */

import { env } from '@/env.mjs';

/**
 * Number of billable AWS Rekognition calls one face search performs.
 *
 * Our search issues exactly ONE call — `SearchFacesByImageCommand`
 * (`src/lib/aws/face-indexing.ts`), which bundles face detection + collection
 * search into a single billed Rekognition operation. There is NO separate
 * `DetectFaces` call. (The T-034 ticket assumed 2 calls per search; that was a
 * misconception about the implementation — corrected here.)
 *
 * The cost counters increment by this constant so the global cap reads
 * directly as "N AWS calls/day". If a second billable call is ever added to
 * the search flow, bump this — it's the single source of truth for cost
 * accounting.
 */
export const AWS_CALLS_PER_FACE_SEARCH = 1;

/** Fixed-window length (seconds) for the daily cost caps and the circuit breaker. */
export const FACE_SEARCH_DAILY_WINDOW_SEC = 24 * 60 * 60;

export interface FaceSearchLimits {
  /** Circuit-breaker ceiling: max billable AWS calls across all events per day. */
  globalDailyCalls: number;
  /** Max billable AWS calls for a single event per day. */
  eventDailyCalls: number;
  /** Recipient of the 50%-of-global alert. Undefined ⇒ alerting is a no-op. */
  alertEmail: string | undefined;
}

/**
 * Resolve the configured caps from the environment. Caps come from env vars
 * (with defaults applied in `env.mjs`) so they can be raised the day a real
 * 300-runner event's athletes start searching — without a code deploy.
 */
export function getFaceSearchLimits(): FaceSearchLimits {
  return {
    globalDailyCalls: env.FACE_SEARCH_GLOBAL_DAILY_CALLS,
    eventDailyCalls: env.FACE_SEARCH_EVENT_DAILY_CALLS,
    alertEmail: env.FACE_SEARCH_ALERT_EMAIL,
  };
}

/** Bucket key for the per-event daily cost counter (tier 2). Keyed on the resolved event id. */
export function eventDailyKey(eventId: string): string {
  return `face-search-event-day:${eventId}`;
}

/** Bucket key for the global daily cost counter / circuit breaker (tier 3). */
export function globalDailyKey(): string {
  return 'face-search-global-day';
}

/**
 * Bucket key for the atomic "50% alert already sent" claim. Keyed on an ISO
 * timestamp that uniquely identifies the current day-window (the caller passes
 * the window's `resetAt`), so the alert fires once per day-window across all
 * serverless instances — whoever atomically claims count === 1 sends the email.
 */
export function alertClaimKey(windowIso: string): string {
  return `face-search-alert:global-50:${windowIso}`;
}

/**
 * True when the global daily count has reached 50% of the cap. Every request
 * past the halfway mark returns true; the atomic claim bucket
 * (`alertClaimKey`) ensures only the first one actually emails.
 */
export function shouldAlertAtFiftyPercent(globalCount: number, globalCap: number): boolean {
  if (globalCap <= 0) return false;
  return globalCount >= Math.ceil(globalCap / 2);
}
