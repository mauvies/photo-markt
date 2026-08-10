import type React from 'react';

// Semantic wrappers that let react-day-picker render proper table elements
// while preserving full className control from the parent.

function MobileMonthGrid({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={className} {...props} />;
}

function MobileWeeks({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

/**
 * ⚠️ The weekday header row must sit inside a `<thead>`.
 *
 * `<table><tr>` is not valid HTML: the parser silently re-parents a stray `<tr>`
 * into an implicit `<tbody>`, so the DOM the browser builds has a row group
 * React never rendered — a hydration mismatch on the home page's mobile date
 * picker. (`Weeks` below already renders a real `<tbody>`, which is why only
 * this row was affected.) `<thead>` is a `table-header-group`, the same box the
 * implicit `<tbody>` was producing, so the layout is unchanged — the `flex`
 * classNames the caller passes still land on the `<tr>` itself.
 */
function MobileWeekdays({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <thead>
      <tr className={className} {...props}>
        {children}
      </tr>
    </thead>
  );
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
