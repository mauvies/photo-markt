'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { updateProfile } from '@/database/queries/profiles';
import { createClient } from '@/database/server';
import { getLangFromHeaders } from '@/lib/i18n/get-lang-from-headers';
import { localizedRedirect } from '@/lib/i18n/redirect';

/**
 * Update the photographer's public profile (username, display name, bio).
 * Also busts the public photographer profile cache for both old and new slugs.
 */
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

  // Fetch current slug so we can revalidate the old public profile cache
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('slug')
    .eq('id', user.id)
    .maybeSingle();
  const oldSlug = currentProfile?.slug;

  const newSlug = values.username.trim();

  await updateProfile(supabase, user.id, {
    username: newSlug,
    slug: newSlug,
    display_name: values.display_name?.trim() || null,
    bio: values.bio?.trim() || null,
  });

  revalidatePath('/es/dashboard/photographer/profile');
  revalidatePath('/en/dashboard/photographer/profile');

  // Bust the public profile cache (old slug in case username changed)
  if (oldSlug) revalidateTag(`photographer-${oldSlug}`, 'max');
  if (newSlug !== oldSlug) revalidateTag(`photographer-${newSlug}`, 'max');

  // After save, return the photographer to the dashboard-wrapped preview
  // so they immediately see the result without leaving the dashboard
  // chrome. `localizedRedirect` throws the Next.js NEXT_REDIRECT exception,
  // which the form's submit handler will surface to React — no
  // client-side router.push needed.
  const lang = await getLangFromHeaders();
  localizedRedirect(lang, '/dashboard/photographer/profile/preview');
}
