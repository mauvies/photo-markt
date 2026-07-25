'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex size-8 shrink-0 overflow-hidden rounded-full border border-muted-foreground/50',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      // `absolute inset-0` pins the image to all four edges of the (bordered)
      // circle so it stays perfectly concentric — as a flex item it could pick
      // up a sub-pixel offset and look shifted against the border. `object-cover`
      // centre-crops non-square sources instead of stretching/offsetting them.
      className={cn('absolute inset-0 size-full object-cover', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('bg-muted flex size-full items-center justify-center rounded-full', className)}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
