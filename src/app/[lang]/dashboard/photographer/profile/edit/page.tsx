import { redirect } from 'next/navigation';

export default async function PhotographerProfileEditLegacyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/dashboard/photographer/settings/profile`);
}
