'use client';

import { useQuery } from '@tanstack/react-query';
import { getActiveRole } from '@/app/[lang]/actions/roles';
import type { RoleSlug } from '@/lib/roles';

/** Shared React Query key for the client-side active-role read. Exported so
 * the role-switch handlers can invalidate it — `switchRole()` only
 * `revalidatePath`s server routes, which never touches this client cache. */
export const ACTIVE_ROLE_KEY = ['active-role'] as const;

/**
 * Client-side read of the current user's active role — lets `Nav` decide
 * whether an authenticated visitor gets the talent header (cart/favorites/
 * avatar-dropdown) or the plain avatar. Gated on `enabled` (pass `!!user`
 * from `useAuthUser`) so anonymous visitors never pay the round-trip.
 * `activeRole` is `undefined` until resolved — callers should treat that the
 * same as "not talent" (render the existing plain-avatar branch) rather than
 * flashing the talent header then swapping it out.
 */
export function useActiveRole(enabled: boolean): { activeRole: RoleSlug | undefined } {
  const { data } = useQuery({
    queryKey: ACTIVE_ROLE_KEY,
    queryFn: async () => {
      const { activeRole } = await getActiveRole();
      return activeRole;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { activeRole: data };
}
