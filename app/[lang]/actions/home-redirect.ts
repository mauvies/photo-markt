'use server';

import { getProfileFields } from '@/database/queries';
import { createClient } from '@/database/server';

/** Returns the dashboard path to redirect to if the user is logged in, or null if not. */
export async function getHomeRedirectPath(): Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await getProfileFields(supabase, user.id, ['active_role']);

  return profile?.active_role === 'PHOTOGRAPHER' ? '/dashboard/photographer' : '/dashboard/talent';
}
