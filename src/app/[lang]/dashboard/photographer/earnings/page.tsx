import { localizedRedirect } from '@/lib/i18n/redirect';

// Legacy alias for the merged sales/earnings page. Redirects directly to the
// unified surface with the Earnings tab pre-selected.
export default async function EarningsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return localizedRedirect(lang, '/dashboard/photographer/sales?tab=earnings');
}
