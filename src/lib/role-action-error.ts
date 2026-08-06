/**
 * Why a role mutation failed, and how that reason becomes copy (T-234).
 *
 * Client-safe on purpose, like `checkout-error.ts`: the code is produced by a
 * Server Action and rendered by a client component, so it has to live in a
 * module both can import. The *reason* has to survive the RSC boundary as a
 * code rather than a message because Next redacts thrown Server Action messages
 * in production (the T-189 finding) — a thrown string reaches the browser as
 * "An error occurred in the Server Components render", which is precisely the
 * silence this ticket removes.
 */

export type RoleActionErrorCode = 'not_signed_in' | 'invalid_role' | 'role_not_held' | 'failed';

export interface RoleActionErrorLabels {
  roleActionFailed?: string;
  roleActionNotSignedIn?: string;
}

/**
 * Resolve a failure code to user-facing copy. `not_signed_in` is the one case
 * with a distinct remedy (sign in again) — every other code is a "we couldn't
 * do it, try again" from the user's point of view, and spelling out
 * `role_not_held` would be worse than useless: the menu only offers a switch
 * for a role the user holds, so seeing it means the UI and the server disagree,
 * not that the user did something wrong.
 */
export function roleActionErrorLabel(
  code: RoleActionErrorCode,
  labels: RoleActionErrorLabels,
): string {
  if (code === 'not_signed_in') {
    return labels.roleActionNotSignedIn ?? 'Please sign in again to change your role.';
  }
  return labels.roleActionFailed ?? "We couldn't change your role. Please try again.";
}
