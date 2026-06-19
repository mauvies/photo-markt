'use client';

import type { User } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createClient } from '@/database/client';

const AUTH_USER_KEY = ['auth-user'] as const;

/**
 * Resolves the current Supabase user on the client.
 *
 * The header used to be a server component that read auth cookies, which
 * forced every page into dynamic rendering. Resolving auth here instead lets
 * the surrounding layout stay statically prerendered. `onAuthStateChange`
 * keeps the value in sync across sign-in / sign-out.
 *
 * `user` is `undefined` until the first resolution — callers should render a
 * neutral placeholder in that window rather than a logged-out state, so a
 * signed-in viewer doesn't flash the login buttons.
 */
export function useAuthUser(): { user: User | null | undefined } {
  const queryClient = useQueryClient();

  const { data: user } = useQuery<User | null>({
    queryKey: AUTH_USER_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // `setQueryData` resolves the value without waiting for the `getUser()`
      // round-trip — `onAuthStateChange` fires INITIAL_SESSION on mount.
      queryClient.setQueryData<User | null>(AUTH_USER_KEY, session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  return { user };
}
