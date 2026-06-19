import { redirect } from 'next/navigation';

export default async function TalentSettingsIndex({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/dashboard/talent/settings/profile`);
}
