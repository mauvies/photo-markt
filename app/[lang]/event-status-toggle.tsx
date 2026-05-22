'use client';

import type { EventStatus } from '@/lib/event-status';

type EventStatusToggleProps = {
  value?: EventStatus;
  onChange: (value: EventStatus | undefined) => void;
  t: { all: string; upcoming: string; completed: string };
};

export function EventStatusToggle({ value, onChange, t }: EventStatusToggleProps) {
  const options: Array<{ label: string; value: EventStatus | undefined }> = [
    { label: t.all, value: undefined },
    { label: t.upcoming, value: 'upcoming' },
    { label: t.completed, value: 'completed' },
  ];

  return (
    <div className="flex items-center gap-5">
      {options.map((opt) => (
        <button
          key={opt.value ?? 'all'}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-sm transition-colors ${
            value === opt.value
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
