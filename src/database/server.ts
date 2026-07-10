import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { env } from '@/env.mjs';

/**
 * Supabase server client for the current request.
 *
 * Wrapped in React `cache()` so every caller within a single render/Server
 * Action/route handler shares one instance instead of re-reading cookies and
 * re-constructing the client. `cache()` is per-request, so distinct requests
 * still get their own client (and their own cookies).
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
});

/**
 * The authenticated user for the current request, or `null` when signed out.
 *
 * Wrapped in React `cache()` so repeated auth checks within a single render
 * (layout + role helpers + page) collapse into a single Supabase Auth
 * round-trip instead of re-authenticating per helper. Combined with the cached
 * `createClient`, a dashboard render drops from ~6 `getUser()` round-trips to
 * one. See ticket T-095.
 *
 * INVARIANT: the result is memoized for the whole request, so it is a snapshot
 * of the user at the *first* call — not a live re-validation. A flow that
 * mutates auth state mid-request (e.g. `exchangeCodeForSession` in the OAuth
 * callback) must NOT rely on this helper reflecting the post-mutation user;
 * read `(await createClient()).auth.getUser()` directly after the mutation.
 * Current callers are all pure reads, so this holds.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
