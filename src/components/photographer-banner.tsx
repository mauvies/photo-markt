'use client';

import { Camera } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthUser } from '@/hooks/use-auth-user';
import { useLocalizedPath } from '@/hooks/use-localized-path';

/**
 * Full-width "I'm a photographer" strip pinned above the header on mobile only.
 * It's the mobile counterpart to the desktop nav's "I'm a photographer" text
 * link (which doesn't fit the compact mobile nav). Shown only on the home page
 * for signed-out visitors — the desktop link already covers every other case.
 *
 * Rendered from the layout (before the header) so it sits at the very top of
 * the page. Auth is resolved client-side, mirroring `Nav`.
 */
export function PhotographerBanner({ label }: { label: string }) {
  const pathname = usePathname() ?? '';
  const lp = useLocalizedPath();
  const { user } = useAuthUser();

  // Home only — strip the locale prefix and match the root path.
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  if (pathWithoutLang !== '/') return null;

  // Render nothing while auth is unresolved (undefined) or for signed-in users,
  // so the banner never flashes to a logged-in viewer.
  if (user !== null) return null;

  return (
    <div className="md:hidden">
      <Link
        href={lp('/photographers')}
        className="flex w-full items-center justify-center gap-2 bg-gray-100 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
      >
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </Link>
    </div>
  );
}
