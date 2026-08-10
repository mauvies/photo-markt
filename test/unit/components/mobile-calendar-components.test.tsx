/** @vitest-environment happy-dom */
/**
 * Regression: `Weekdays` rendered a bare `<tr>` straight into the `<table>` the
 * `MonthGrid` override produces. That is invalid HTML — the parser re-parents a
 * stray `<tr>` into an implicit `<tbody>` — so the DOM the browser built had a
 * row group React never rendered, and the home page's mobile date picker threw
 * a hydration error ("In HTML, <tr> cannot be a child of <table>").
 *
 * These assert the SHAPE the overrides produce, since that shape is the whole
 * reason the overrides exist.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOBILE_CALENDAR_COMPONENTS } from '@/components/event-search-bar/MobileCalendarComponents';

afterEach(cleanup);

const { MonthGrid, Weekdays, Weekday, Weeks, Week, Day } = MOBILE_CALENDAR_COMPONENTS;

/** The nesting react-day-picker builds from these overrides. */
function MonthTable() {
  return (
    <MonthGrid className="w-full">
      <Weekdays className="flex w-full">
        <Weekday className="weekday">Mo</Weekday>
      </Weekdays>
      <Weeks>
        <Week week={{}} className="flex w-full mt-2">
          <Day day={{}} modifiers={{}}>
            1
          </Day>
        </Week>
      </Weeks>
    </MonthGrid>
  );
}

describe('MOBILE_CALENDAR_COMPONENTS', () => {
  it('never puts a <tr> directly inside the <table>', () => {
    const { container } = render(<MonthTable />);
    const table = container.querySelector('table') as HTMLTableElement;

    for (const child of Array.from(table.children)) {
      expect(['THEAD', 'TBODY', 'TFOOT', 'CAPTION', 'COLGROUP']).toContain(child.tagName);
    }
  });

  it('puts the weekday row in a <thead> and the weeks in a <tbody>', () => {
    const { container } = render(<MonthTable />);
    expect(container.querySelector('table > thead > tr > th')?.textContent).toBe('Mo');
    expect(container.querySelector('table > tbody > tr > td')?.textContent).toBe('1');
  });

  it('keeps the caller-supplied layout classes on the row itself', () => {
    // The parent styles the calendar by passing `weekdays: 'flex w-full'` —
    // moving that class onto the <thead> would break the header layout.
    const { container } = render(<MonthTable />);
    const headerRow = container.querySelector('table > thead > tr') as HTMLElement;
    expect(headerRow.className).toBe('flex w-full');
    expect((container.querySelector('table > thead') as HTMLElement).className).toBe('');
  });
});
