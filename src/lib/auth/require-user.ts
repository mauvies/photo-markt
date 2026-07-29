import type { User } from '@supabase/supabase-js';
import { getUser } from '@/database/server';
import { redirectToLogin } from './redirect-to-login';

/**
 * The authenticated user for the current request, or a redirect to login.
 *
 * **Every dashboard segment that reads auth-dependent data must call this
 * first — a parent layout's guard does NOT protect it.** Next renders the
 * segments of a route (parent layout → child layout → page) *in parallel*, so
 * `dashboard/layout.tsx` throwing NEXT_REDIRECT does not stop
 * `dashboard/talent/layout.tsx` from executing. When a child segment reacts to
 * a missing user by throwing a plain Error (as `getRoleContext()` and
 * `getProfileFields(supabase, '')` both do), that error races the parent's
 * redirect — and whichever settles first is what the visitor sees. That race is
 * the intermittent "Something went wrong" screen on `/[lang]/dashboard/talent`
 * reported in T-198.
 *
 * Redirecting instead of throwing makes the race harmless: every competing
 * outcome is now a redirect, so the visitor always lands on a page.
 *
 * Reads through the request-cached `getUser()` (T-095) so all segments of one
 * render share a single auth snapshot and cannot disagree about who is signed
 * in.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();

  if (!user) {
    // Throws NEXT_REDIRECT — never returns.
    return redirectToLogin();
  }

  return user;
}
