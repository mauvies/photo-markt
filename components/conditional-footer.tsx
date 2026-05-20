'use client';

import { usePathname } from 'next/navigation';

/**
 * Renders the footer only on marketing / informational pages: the landing
 * page, public photographer profiles, and the legal/company pages.
 *
 * App-like and transactional surfaces — event browsing, dashboards, auth,
 * cart/checkout — stay footer-free so the footer doesn't compete with the
 * task at hand (industry-standard behavior).
 */
const STATIC_FOOTER_PATHS = ['/terms', '/privacy-policy', '/about', '/contact'];

export function ConditionalFooter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const path = pathname.replace(/^\/(es|en)/, '') || '/';
  const showFooter =
    path === '/' || path.startsWith('/photographer/') || STATIC_FOOTER_PATHS.includes(path);

  if (!showFooter) return null;
  return <>{children}</>;
}
