import { localizedRedirect } from '@/lib/i18n/redirect';

// Overview section hidden — talent lands on explore page instead
export default async function TalentDashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  localizedRedirect(lang, '/dashboard/talent/events');
}
