import { redirect } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { PhotographerPublicProfile } from '@/components/photographer-public-profile';
import { getProfileFields } from '@/database/queries';
import { createClient } from '@/database/server';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

/**
 * Dashboard-wrapped preview of the photographer's own public profile.
 *
 * Renders the exact same UI as `/photographer/[slug]` but inherits the
 * photographer dashboard layout (sidebar + mobile bottom-nav + top header),
 * so the photographer can see how their public face looks without leaving
 * the dashboard chrome.
 *
 * The canonical shareable URL stays `/photographer/[slug]`. The "Copy
 * profile link" button inside the shared component always copies that
 * public URL, not this dashboard-internal one.
 */
export default async function PhotographerProfilePreviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const dict = await getDictionary(lang as Locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  // The photographer's slug is their `username` (slug column mirrors
  // username per profiles.ts convention). If they don't have one yet,
  // bounce to the edit page so they can set it.
  const profile = await getProfileFields(supabase, user.id, ['username']);
  if (!profile?.username) {
    redirect(`/${lang}/dashboard/photographer/profile/edit`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <DashboardHeader title={dict.dashboard.profile} />
      <PhotographerPublicProfile slug={profile.username} lang={lang} dict={dict} isOwner={true} />
    </div>
  );
}
