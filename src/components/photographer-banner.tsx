'use client';

import { Camera } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthUser } from '@/hooks/use-auth-user';
import { useLocalizedPath } from '@/hooks/use-localized-path';

/** `py-2` (8px × 2) around a `text-sm` line box (20px) — the strip is 36px tall
 *  whether it renders its link or its placeholder. Both share these classes so
 *  the two footprints cannot drift apart. */
const STRIP_CLASSNAME = 'flex w-full items-center justify-center gap-2 bg-gray-100 py-2 text-sm';

/**
 * Full-width "I'm a photographer" strip pinned above the header on mobile only.
 * It's the mobile counterpart to the desktop nav's "I'm a photographer" text
 * link (which doesn't fit the compact mobile nav). Shown only on the home page
 * for signed-out visitors — the desktop link already covers every other case.
 *
 * Rendered from the layout (before the header) so it sits at the very top of
 * the page. Auth is resolved client-side, mirroring `Nav`.
 *
 * ⚠️ Because it sits at `top: 0` of the whole document, appearing late doesn't
 * shift *part* of the home page — it shifts ALL of it. So the unresolved-auth
 * state reserves the strip's exact 36px instead of rendering nothing. Same call
 * `Nav` already makes for its own auth slot, and for the same reason: the strip
 * only ever renders for signed-out visitors, which is who the public home page
 * is overwhelmingly for, so reserving its footprint is right for nearly every
 * visitor. A signed-in viewer trades the old downward jolt for a smaller upward
 * collapse of the same 36px once auth resolves.
 */
export function PhotographerBanner({ label }: { label: string }) {
  const pathname = usePathname() ?? '';
  const lp = useLocalizedPath();
  const { user } = useAuthUser();

  // Home only — strip the locale prefix and match the root path. Checked before
  // the auth state so no other route ever reserves space for a strip it can't
  // render.
  const pathWithoutLang = pathname.replace(/^\/(es|en)/, '') || '/';
  if (pathWithoutLang !== '/') return null;

  // Auth unresolved: hold the strip's place. The grey background is the real
  // one, so resolving only fills in the icon + label rather than inserting a
  // band of colour.
  if (user === undefined) {
    return (
      <div className="md:hidden" aria-hidden="true">
        <div className={STRIP_CLASSNAME}>
          <Skeleton className="h-5 w-44 bg-gray-200" />
        </div>
      </div>
    );
  }

  // Signed in — the banner never applies, so it stays out of the layout.
  if (user !== null) return null;

  return (
    <div className="md:hidden">
      <Link
        href={lp('/photographers')}
        className={`${STRIP_CLASSNAME} text-gray-600 transition-colors hover:bg-gray-200`}
      >
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </Link>
    </div>
  );
}
