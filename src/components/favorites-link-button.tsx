'use client';

import { Heart } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';

/**
 * Favorites entry point for the authenticated-talent header (T-118) — a peer
 * icon next to the cart and avatar, not a text nav link. Reserves the same
 * `h-10 w-10` slot as `CartLinkButton` so it lines up in the header row, but
 * (unlike the cart) it's always visible — favorites has no analogous
 * "hide when empty" product decision.
 */
export function FavoritesLinkButton({ label }: { label: string }) {
  const lp = useLocalizedPath();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
      {/* Locale-prefixed — an un-prefixed href would make proxy.ts re-resolve
          the locale from Accept-Language and could silently switch language. */}
      <Link href={lp('/dashboard/talent/favorites')}>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 p-0 hover:bg-accent"
          aria-label={label}
        >
          <Heart className="h-6 w-6" />
        </Button>
      </Link>
    </div>
  );
}
