'use client';

import { Compass, FolderOpen, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  cartItemCount: number;
}

export function QuickActions({ cartItemCount }: QuickActionsProps) {
  const lp = useLocalizedPath();
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Quick Actions</h2>
      <div className="space-y-2 sm:space-y-3">
        <Link
          href={lp('/dashboard/talent/events')}
          className={cn(
            buttonVariants({ variant: 'default', size: 'lg' }),
            'w-full justify-start text-sm sm:text-base',
          )}
        >
          <Compass className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
          Explore Events
        </Link>
        <Link
          href={lp('/dashboard/talent/favorites')}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'w-full justify-start text-sm sm:text-base',
          )}
        >
          <FolderOpen className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
          View Your Photos
        </Link>
        {cartItemCount > 0 && (
          <Link
            href={lp('/dashboard/talent/cart')}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'w-full justify-start text-sm sm:text-base relative',
            )}
          >
            <ShoppingCart className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
            View Cart
            <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {cartItemCount}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
