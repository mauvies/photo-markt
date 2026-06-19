import { env } from '@/env.mjs';

/**
 * Returns the canonical site URL (e.g. https://photomarkt.com).
 * Server-only — uses the validated SITE_URL env var.
 */
export function getSiteUrl(): string {
  return env.SITE_URL;
}
