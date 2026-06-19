import type React from 'react';

// Semantic wrappers that let react-day-picker render proper table elements
// while preserving full className control from the parent.

function MobileMonthGrid({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={className} {...props} />;
}

function MobileWeeks({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

function MobileWeekdays({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}

function MobileWeekday({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={className} {...props} />;
}

function MobileWeek({
  week: _week,
  className,
  ...props
}: { week: unknown } & React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...(props as React.HTMLAttributes<HTMLTableRowElement>)} />;
}

function MobileDay({
  day: _day,
  modifiers: _modifiers,
  className,
  ...props
}: { day: unknown; modifiers: unknown } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={className} {...props} />;
}

export const MOBILE_CALENDAR_COMPONENTS = {
  MonthGrid: MobileMonthGrid,
  Weeks: MobileWeeks,
  Weekdays: MobileWeekdays,
  Weekday: MobileWeekday,
  Week: MobileWeek,
  Day: MobileDay,
};
