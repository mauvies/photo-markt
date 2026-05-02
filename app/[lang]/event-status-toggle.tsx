'use client';

import { useRouter } from 'next/navigation';
import type { EventStatus } from '@/lib/event-status';

type EventStatusToggleProps = {
  current?: EventStatus;
  basePath: string;
  t: { all: string; upcoming: string; completed: string };
};

export function EventStatusToggle({ current, basePath, t }: EventStatusToggleProps) {
  const router = useRouter();

  const options: Array<{ label: string; value: EventStatus | undefined }> = [
    { label: t.all, value: undefined },
    { label: t.upcoming, value: 'upcoming' },
    { label: t.completed, value: 'completed' },
  ];

  const handleClick = (value: EventStatus | undefined) => {
    const url = value ? `${basePath}?status=${value}` : basePath;
    router.push(url, { scroll: false });
  };

  return (
    <div className="flex items-center gap-5">
      {options.map((opt) => (
        <button
          key={opt.value ?? 'all'}
          type="button"
          onClick={() => handleClick(opt.value)}
          className={`text-sm transition-colors ${
            current === opt.value
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
