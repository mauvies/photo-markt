import { localizedRedirect } from '@/lib/i18n/redirect';

// Legacy alias for the merged sales/earnings page. Redirects to the unified
// surface (defaults to the Sales tab).
export default async function VentasPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return localizedRedirect(lang, '/dashboard/photographer/sales');
}
