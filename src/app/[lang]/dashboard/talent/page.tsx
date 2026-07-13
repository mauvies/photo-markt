import { localizedRedirect } from '@/lib/i18n/redirect';

// T-118: `/` is the unified talent home/explore page now — no dedicated
// overview or explore route lives under /dashboard/talent anymore.
export default async function TalentDashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  localizedRedirect(lang, '/');
}
