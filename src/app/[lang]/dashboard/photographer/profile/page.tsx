import { redirect } from 'next/navigation';

/**
 * Legacy route. The photographer's profile entry now lives at
 * /dashboard/photographer/profile/preview — same UI as the public page but
 * wrapped in the dashboard chrome. Any inbound link to the bare
 * /dashboard/photographer/profile (old bookmarks, revalidatePath calls,
 * etc.) lands here and bounces forward.
 *
 * Edits live at /dashboard/photographer/profile/edit (no redirect — Next
 * matches the more-specific child route first).
 */
export default async function PhotographerProfileLegacyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/dashboard/photographer/profile/preview`);
}
