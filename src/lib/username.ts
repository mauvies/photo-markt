/**
 * Username normalization and validation rules, shared by the client form,
 * the onboarding server action, and the availability check so the rules can't
 * drift between call sites.
 *
 * The database backing these rules: `profiles.username` is NOT NULL, UNIQUE,
 * and CHECK (length 3-30 AND value ~ '^[a-z0-9_-]+$').
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Normalize a raw username: lowercase and strip every character outside
 * `[a-z0-9_-]`. Does NOT enforce length — callers validate with
 * {@link isValidUsername} afterwards.
 */
export function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/**
 * True when `value` is a valid, already-normalized username: 3-30 characters
 * and matching `^[a-z0-9_-]+$`.
 */
export function isValidUsername(value: string): boolean {
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    return false;
  }
  return USERNAME_PATTERN.test(value);
}
