'use client';

import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useGuestCart } from '@/components/guest-cart-provider';
import { Button } from '@/components/ui/button';
import { useCartItemCount } from '@/hooks/use-cart-item-count';
import { cn } from '@/lib/utils';

function AuthCartLinkButton() {
  const cartItemCount = useCartItemCount();
  return <CartIconButton href="/dashboard/talent/cart" count={cartItemCount} />;
}

function GuestCartLinkButton() {
  const { itemCount } = useGuestCart();
  return <CartIconButton href="/cart" count={itemCount} />;
}

function CartIconButton({ href, count }: { href: string; count: number }) {
  // The cart icon appears only when the cart holds at least one item — an
  // empty cart shows nothing (applies to both the auth and guest carts).
  // The slot itself is always reserved at the icon's size so the count
  // resolving async (0 -> N on fetch/hydration) never reflows neighboring
  // header items — same pattern as the avatar's loading Skeleton.
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
      {count > 0 && (
        <Link href={href}>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-10 w-10 p-0 hover:bg-accent"
            aria-label="Shopping cart"
          >
            <ShoppingCart className="h-6 w-6" />
            <span
              className={cn(
                'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                'bg-primary text-primary-foreground',
              )}
            >
              {count > 99 ? '99+' : count}
            </span>
          </Button>
        </Link>
      )}
    </div>
  );
}

export function CartLinkButton({ guest = false }: { guest?: boolean }) {
  if (guest) return <GuestCartLinkButton />;
  return <AuthCartLinkButton />;
}
