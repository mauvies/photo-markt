/**
 * Naming convention for per-event AWS Rekognition collection IDs.
 *
 * Format: `${prefix}-${env}-event-${eventId}`
 *
 * - `prefix` is read from `REKOGNITION_COLLECTION_PREFIX` (default `photomarkt`).
 * - `env` is `staging` or `production`. Inferred at call time so the same
 *   build can target either depending on which env vars are loaded.
 * - AWS allows `[a-zA-Z0-9_.\-]` and caps the id at 255 chars. UUIDs only
 *   contain valid characters, but we sanitize defensively in case anyone
 *   passes a non-UUID id later.
 */

import { env } from '@/env.mjs';

const MAX_COLLECTION_ID_LENGTH = 255;
const ALLOWED_CHARS = /[^a-zA-Z0-9_.-]/g;

export type DeploymentEnv = 'staging' | 'production';

/**
 * Pick the deployment env that this collection id should be namespaced
 * under. Defaults to `staging` for any non-production NODE_ENV — keeps local
 * dev and Vercel previews from accidentally writing into prod collections.
 */
export function getDeploymentEnv(): DeploymentEnv {
  return env.NODE_ENV === 'production' ? 'production' : 'staging';
}

export function buildCollectionId(
  eventId: string,
  deploymentEnv: DeploymentEnv = getDeploymentEnv(),
): string {
  const prefix = env.REKOGNITION_COLLECTION_PREFIX;
  const raw = `${prefix}-${deploymentEnv}-event-${eventId}`;
  const sanitized = raw.replace(ALLOWED_CHARS, '-');
  return sanitized.slice(0, MAX_COLLECTION_ID_LENGTH);
}
