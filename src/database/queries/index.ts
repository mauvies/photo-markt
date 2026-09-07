/**
 * Database Query Functions
 *
 * Central export point for all database queries organized by domain.
 * This makes it easier to maintain, test, and potentially replace the database in the future.
 */

// Re-export bib-number queries
export * from './bib-numbers';
// Re-export cart queries
export * from './carts';
// Re-export download token queries
export * from './download-tokens';
// Re-export earnings queries
export * from './earnings';
// Re-export event cover / OG image URL resolution (T-140)
export * from './event-covers';
// Re-export event-photographers (organizer event memberships) queries
export * from './event-photographers';
// Re-export event queries
export * from './events';
// Re-export feedback and roadmap vote queries
export * from './feedback';
// Re-export guest order queries
export * from './guest-orders';
// Re-export order queries
export * from './orders';
// Re-export payout queries
export * from './payouts';
// Re-export photographer queries
export * from './photographers';
// Re-export photo queries
export * from './photos';
// Re-export profile queries
export * from './profiles';
// Re-export rate-limit bucket maintenance (T-218)
export * from './rate-limit-buckets';
// Re-export AWS Rekognition queries (event AI state + photo_faces)
export * from './rekognition';
// Re-export sales queries
export * from './sales';
// Re-export saved-events (talent event bookmark) queries
export * from './saved-events';
// Re-export storage queries
export * from './storage';
// Re-export subscription queries
export * from './subscriptions';
// Re-export talent library queries
export * from './talent-library';
// Re-export talent photo tag queries
export * from './talent-photo-tags';
// Re-export types
export type { SupabaseServerClient } from './types';
export { getErrorMessage } from './types';
// Re-export user role queries
export * from './user-roles';
