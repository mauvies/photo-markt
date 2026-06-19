/**
 * Rate limiting configuration for AI search based on subscription tiers
 */

import type { PlanId } from '@/lib/plans';

export interface RateLimitConfig {
  /**
   * Maximum number of AI searches allowed per month
   * null = unlimited
   */
  maxSearchesPerMonth: number | null;

  /**
   * Description of the limit for UI display
   */
  description: string;
}

/**
 * Rate limit configuration per subscription plan
 */
export const AI_SEARCH_RATE_LIMITS: Record<PlanId, RateLimitConfig> = {
  free: {
    maxSearchesPerMonth: 3,
    description: '3 searches per month',
  },
  starter: {
    maxSearchesPerMonth: 20,
    description: '20 searches per month',
  },
  pro: {
    maxSearchesPerMonth: null, // Unlimited
    description: 'Unlimited searches',
  },
};

/**
 * Get rate limit configuration for a plan
 */
export function getRateLimitForPlan(planId: PlanId): RateLimitConfig {
  return AI_SEARCH_RATE_LIMITS[planId] ?? AI_SEARCH_RATE_LIMITS.free;
}

/**
 * Check if a user has exceeded their rate limit
 */
export function hasExceededRateLimit(planId: PlanId, currentUsage: number): boolean {
  const limit = getRateLimitForPlan(planId);

  // Unlimited plans never exceed
  if (limit.maxSearchesPerMonth === null) {
    return false;
  }

  return currentUsage >= limit.maxSearchesPerMonth;
}

/**
 * Get remaining searches for a user
 */
export function getRemainingSearches(planId: PlanId, currentUsage: number): number | null {
  const limit = getRateLimitForPlan(planId);

  // Unlimited plans return null
  if (limit.maxSearchesPerMonth === null) {
    return null;
  }

  return Math.max(0, limit.maxSearchesPerMonth - currentUsage);
}
