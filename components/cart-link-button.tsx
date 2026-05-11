'use client';

import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { getCartItemCountAction } from '@/app/[lang]/dashboard/talent/cart/actions';
import { useGuestCart } from '@/components/guest-cart-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function AuthCartLinkButton() {
  const { data: cartItemCount = 0 } = useQuery({
    queryKey: ['cart-count'] as const,
    queryFn: async () => {
      try {
        return await getCartItemCountAction();
      } catch {
        return 0;
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  return <CartIconButton href="/dashboard/talent/cart" count={cartItemCount} />;
}

function GuestCartLinkButton() {
  const { itemCount } = useGuestCart();
  return <CartIconButton href="/cart" count={itemCount} />;
}

function CartIconButton({ href, count }: { href: string; count: number }) {
  return (
    <Link href={href}>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-10 w-10 p-0 hover:bg-accent"
        aria-label="Shopping cart"
      >
        <ShoppingCart className="h-6 w-6" />
        {count > 0 && (
          <span
            className={cn(
              'absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
              'bg-primary text-primary-foreground',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
    </Link>
  );
}

export function CartLinkButton({ guest = false }: { guest?: boolean }) {
  if (guest) return <GuestCartLinkButton />;
  return <AuthCartLinkButton />;
}
