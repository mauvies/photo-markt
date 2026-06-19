'use server';

import { revalidatePath } from 'next/cache';
import { updateProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';

/** Update the talent user's profile from the settings page (username, display name, bio). */
export async function updateProfileAction(values: {
  username: string;
  display_name?: string | null;
  bio?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  // Check if username is already taken by another user
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', values.username)
    .neq('id', user.id)
    .maybeSingle();

  if (existingProfile) {
    throw new Error('Username is already taken');
  }

  await updateProfile(supabase, user.id, {
    username: values.username.trim(),
    display_name: values.display_name?.trim() || null,
    bio: values.bio?.trim() || null,
  });

  revalidatePath('/es/dashboard/talent/settings');
  revalidatePath('/en/dashboard/talent/settings');
  revalidatePath('/es/dashboard/talent/profile');
  revalidatePath('/en/dashboard/talent/profile');
}
