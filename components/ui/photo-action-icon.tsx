'use client';

import { Check, Heart, Loader2, ShoppingCart, Trash2, UserPlus, Users } from 'lucide-react';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type PhotoActionIconProps = {
  icon: 'cart' | 'check' | 'tag' | 'save' | 'delete';
  active: boolean;
  onClick: () => void;
  tooltip: string;
  loading?: boolean;
  className?: string;
};

export function PhotoActionIcon({
  icon,
  active,
  onClick,
  tooltip,
  loading = false,
  className,
}: PhotoActionIconProps) {
  // Radix Tooltip opens on touch (it treats touch as pointer-enter), so on
  // mobile a tap briefly shows the tooltip before the click handler runs.
  // For coarse-pointer devices we render the bare button — touch users get
  // the action immediately, hover users still get the tooltip on desktop.
  const isCoarsePointer = useCoarsePointer();

  function renderIcon() {
    if (loading) return <Loader2 className="size-3 animate-spin" />;
    switch (icon) {
      case 'cart':
        return <ShoppingCart className="size-3" fill={active ? 'currentColor' : 'none'} />;
      case 'check':
        return <Check className="size-3" strokeWidth={active ? 3 : 2} />;
      case 'tag':
        return active ? (
          <Users className="size-3" fill="currentColor" />
        ) : (
          <UserPlus className="size-3" />
        );
      case 'save':
        return (
          <Heart className="size-3" strokeWidth={1.5} fill={active ? 'currentColor' : 'none'} />
        );
      case 'delete':
        return <Trash2 className="size-3" strokeWidth={1.75} />;
    }
  }

  // The unselected select-icon nudges to a slightly lighter shade so it
  // reads as a tappable affordance against the photo, while keeping the
  // same dark-pill look. All other icons (cart, tag, save, delete) and the
  // active/selected check keep the original styling untouched.
  const isUnselectedSelect = icon === 'check' && !active;

  const button = (
    <button
      type="button"
      className={cn(
        'flex size-6 items-center justify-center rounded-full text-white backdrop-blur-sm shadow-sm transition-colors',
        isUnselectedSelect
          ? 'bg-gray-700/55 hover:bg-gray-700/80'
          : 'bg-gray-900/45 hover:bg-gray-900/80',
        active && 'bg-gray-900/80',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={tooltip}
    >
      {renderIcon()}
    </button>
  );

  if (isCoarsePointer) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
