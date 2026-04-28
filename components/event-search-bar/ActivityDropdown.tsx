'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { ActivityOption } from './EventSearchBar.types';

const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_OFFSET = 8;

export function ActivityDropdown({
  filtered,
  anchorRef,
  onSelect,
  compact,
}: {
  filtered: ActivityOption[];
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (opt: ActivityOption) => void;
  compact?: boolean;
}) {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const [openUpward, setOpenUpward] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < DROPDOWN_MAX_HEIGHT + DROPDOWN_OFFSET && rect.top > spaceBelow;

    setOpenUpward(goUp);
    setStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, compact ? 200 : 220),
      zIndex: 9999,
      ...(goUp
        ? { bottom: window.innerHeight - rect.top + DROPDOWN_OFFSET }
        : { top: rect.bottom + DROPDOWN_OFFSET }),
    });
  }, [anchorRef, compact]);

  return createPortal(
    <div
      style={style}
      className={cn(
        'bg-background border shadow-xl overflow-y-auto py-1',
        'max-h-60',
        openUpward
          ? 'rounded-t-2xl rounded-b-lg animate-[dropdown-up_0.15s_ease-out]'
          : 'rounded-2xl animate-[dropdown-down_0.15s_ease-out]',
      )}
    >
      {filtered.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(opt);
          }}
          className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors"
        >
          {opt.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
