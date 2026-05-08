'use client';

import { Check, Heart, Loader2, ShoppingCart, Trash2, UserPlus, Users } from 'lucide-react';
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex size-6 items-center justify-center rounded-full',
            'bg-gray-900/45 backdrop-blur-sm text-white shadow-sm',
            'transition-colors hover:bg-gray-900/80',
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
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
