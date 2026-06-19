'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  addPhotoToCartAction,
  removePhotoFromCartAction,
} from '@/app/[lang]/dashboard/talent/cart/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AddToCartButtonProps {
  photoId: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  showText?: boolean;
  initialInCart?: boolean;
  asDiv?: boolean; // When true, renders as div instead of button (for nested button scenarios)
  customSize?: string; // Override default size classes (e.g., "size-6")
  onAddToCart?: (photoId: string) => void; // When provided, overrides the default server action
  onRemoveFromCart?: (photoId: string) => void; // When provided, overrides the default server action
}

export function AddToCartButton({
  photoId,
  className,
  variant = 'default',
  size = 'sm',
  showText = true,
  initialInCart = false,
  asDiv = false,
  customSize,
  onAddToCart,
  onRemoveFromCart,
}: AddToCartButtonProps) {
  const [isInCart, setIsInCart] = useState(initialInCart);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleAddToCart = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (onAddToCart) {
      onAddToCart(photoId);
      setIsInCart(true);
      return;
    }
    startTransition(async () => {
      try {
        await addPhotoToCartAction(photoId);
        setIsInCart(true);
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success('Added to cart');
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add to cart';
        toast.error(message);
      }
    });
  };

  const handleRemoveFromCart = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (onRemoveFromCart) {
      onRemoveFromCart(photoId);
      setIsInCart(false);
      return;
    }
    startTransition(async () => {
      try {
        await removePhotoFromCartAction(photoId);
        setIsInCart(false);
        queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        toast.success('Removed from cart');
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove from cart';
        toast.error(message);
      }
    });
  };

  const baseClasses = cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    // Use customSize if provided, otherwise use default size classes
    customSize || (size === 'sm' && 'size-8'),
    !customSize && size === 'md' && 'size-10',
    !customSize && size === 'lg' && 'size-12',
    variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'outline' &&
      'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
    variant === 'ghost' && 'hover:bg-accent hover:text-accent-foreground',
    variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    className,
  );

  if (asDiv) {
    if (isInCart) {
      return (
        // biome-ignore lint/a11y/useSemanticElements: Intentionally using div to avoid nested buttons
        <div
          className={cn(baseClasses, 'cursor-pointer relative')}
          onClick={handleRemoveFromCart}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleRemoveFromCart();
            }
          }}
          aria-label="Remove from cart"
          role="button"
          tabIndex={0}
          aria-disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {showText && <span className="ml-2">Removing...</span>}
            </>
          ) : (
            <>
              <ShoppingCart className="h-3 w-3" />
              {showText && <span className="ml-2">In cart</span>}
            </>
          )}
        </div>
      );
    }

    return (
      // biome-ignore lint/a11y/useSemanticElements: Intentionally using div to avoid nested buttons
      <div
        className={cn(baseClasses, 'cursor-pointer')}
        onClick={handleAddToCart}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleAddToCart();
          }
        }}
        aria-label="Add to cart"
        role="button"
        tabIndex={0}
        aria-disabled={isPending}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {showText && <span className="ml-2">Adding...</span>}
          </>
        ) : (
          <>
            <ShoppingCart className="h-3 w-3" />
            {showText && <span className="ml-2">Add to cart</span>}
          </>
        )}
      </div>
    );
  }

  if (isInCart) {
    return (
      <Button
        variant={variant === 'default' || variant === 'secondary' ? 'outline' : variant}
        size={size === 'icon' ? 'sm' : size}
        onClick={handleRemoveFromCart}
        disabled={isPending}
        className={className}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {showText && <span className="ml-2">Removing...</span>}
          </>
        ) : (
          <>
            <Minus className="h-3 w-3" />
            {showText && <span className="ml-2">In cart</span>}
          </>
        )}
      </Button>
    );
  }

  return (
    <Button
      variant={variant === 'secondary' ? 'outline' : variant}
      size={size === 'icon' ? 'sm' : size}
      onClick={handleAddToCart}
      disabled={isPending}
      className={className}
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {showText && <span className="ml-2">Adding...</span>}
        </>
      ) : (
        <>
          <ShoppingCart className="h-3 w-3" />
          <Plus className="h-3 w-3 ml-0.5" />
          {showText && <span className="ml-2">Add to cart</span>}
        </>
      )}
    </Button>
  );
}
