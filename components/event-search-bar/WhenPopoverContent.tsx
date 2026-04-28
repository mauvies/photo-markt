'use client';

import { CalendarIcon, ChevronLeft, Clock } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { last3DaysRange, lastWeekRange, todayRange } from './EventSearchBar.utils';

interface WhenPopoverContentProps {
  dateRange: DateRange | undefined;
  onSelectPreset: (label: string, range: DateRange) => void;
  onSelectCustom: (range: DateRange | undefined) => void;
  mobile?: boolean;
  t: {
    quickOptions: string;
    customDate: string;
    presetToday: string;
    presetLast3Days: string;
    presetLastWeek: string;
  };
}

export function WhenPopoverContent({
  dateRange,
  onSelectPreset,
  onSelectCustom,
  mobile = false,
  t,
}: WhenPopoverContentProps) {
  const [showCalendar, setShowCalendar] = useState(false);

  if (showCalendar) {
    return (
      <div className={mobile ? 'w-full' : undefined}>
        <button
          type="button"
          onClick={() => setShowCalendar(false)}
          className="flex items-center gap-1 px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t.quickOptions}
        </button>
        <Calendar
          mode="range"
          selected={dateRange}
          onSelect={(range) => {
            onSelectCustom(range);
          }}
          numberOfMonths={1}
          {...(mobile && {
            className: '!p-0',
            classNames: { root: 'w-full max-w-full' },
          })}
        />
      </div>
    );
  }

  const presets = [
    { label: t.presetToday, getRange: todayRange },
    { label: t.presetLast3Days, getRange: last3DaysRange },
    { label: t.presetLastWeek, getRange: lastWeekRange },
  ];

  return (
    <div className="w-48 p-3">
      {presets.map(({ label, getRange }) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelectPreset(label, getRange())}
          className="flex w-full items-center gap-2.5 rounded-lg py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
        >
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {label}
        </button>
      ))}
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={() => setShowCalendar(true)}
        className="flex w-full items-center gap-2.5 rounded-lg py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left"
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {t.customDate}
      </button>
    </div>
  );
}
