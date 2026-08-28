/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * T-251 — a photographer with one event and 35 photos saw «Fotos subidas: 0»
 * and «Eventos creados: 0».
 *
 * The numbers were right and the labels lied: every card in this row is a
 * CURRENT-MONTH figure, but only two of the four labels said so. His event and
 * its photos were created the previous month, so the month window legitimately
 * held zero of each — under a label promising an all-time count.
 *
 * Two things are pinned here:
 *   1. every card names its period, and
 *   2. the all-time totals — already computed on every render of this page and
 *      previously used for nothing but the `isBrandNew` flag — actually reach
 *      the screen. ⚠️ The reported case has `trend === null` (last month was 0
 *      too, so `computePct` returns null), so a sublabel that only rendered in
 *      the absence of a trend would vanish in exactly this scenario.
 */

import { MetricsRow } from '@/app/[lang]/dashboard/photographer/_components/metrics-row';
import en from '@/dictionaries/en.json';
import es from '@/dictionaries/es.json';

afterEach(cleanup);

const t = {
  earningsThisMonth: en.photographerDashboard.earningsThisMonth,
  salesThisMonth: en.photographerDashboard.salesThisMonth,
  photosUploadedThisMonth: en.photographerDashboard.photosUploadedThisMonth,
  eventsCreatedThisMonth: en.photographerDashboard.eventsCreatedThisMonth,
  vsLastMonth: en.photographerDashboard.vsLastMonth,
  allTimeTotal: en.photographerDashboard.allTimeTotal,
};

/** The reported account: everything created last month, nothing this one. */
const reportedCase = {
  metrics: {
    earningsCents: 0,
    sales: 0,
    photosUploaded: 0,
    eventsCreated: 0,
    // Last month was zero as well for earnings/sales, and `computePct` returns
    // null whenever the previous window is 0 — so NO card has a trend here.
    trend: { earningsPct: null, salesPct: null, photosPct: null, eventsPct: null },
  },
  totals: { totalEvents: 1, totalPhotos: 35 },
};

describe('MetricsRow', () => {
  it('shows the all-time totals next to the month counts, even with no trend', () => {
    render(<MetricsRow metrics={reportedCase.metrics} totals={reportedCase.totals} t={t} />);

    // The month figures are still what the queries returned.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    // ...but the history the photographer knows he has is on screen too, so the
    // page cannot be read as "I have nothing".
    expect(screen.getByText('35 all time')).toBeTruthy();
    expect(screen.getByText('1 all time')).toBeTruthy();
  });

  it('keeps the trend AND the total when both exist', () => {
    render(
      <MetricsRow
        metrics={{
          ...reportedCase.metrics,
          photosUploaded: 12,
          trend: { ...reportedCase.metrics.trend, photosPct: 50 },
        }}
        totals={reportedCase.totals}
        t={t}
      />,
    );

    expect(screen.getByText('+50%')).toBeTruthy();
    expect(screen.getByText('35 all time')).toBeTruthy();
  });
});

describe('metric labels', () => {
  // The two that broke are exactly the two whose copy had lost the period the
  // dictionary key still promised (`...ThisMonth`).
  it.each([
    ['en', en.photographerDashboard, 'this month'],
    ['es', es.photographerDashboard, 'del mes'],
  ])('every %s card declares the period it covers', (_lang, dict, marker) => {
    for (const key of [
      'earningsThisMonth',
      'salesThisMonth',
      'photosUploadedThisMonth',
      'eventsCreatedThisMonth',
    ] as const) {
      expect(dict[key].toLowerCase()).toContain(marker);
    }
  });

  it('does not reuse one label for a monthly count and an all-time one', () => {
    // `photosUploaded` is the storage total on the billing page; the dashboard
    // card is a monthly count. They must not read as the same thing.
    expect(en.photographerDashboard.photosUploaded).not.toBe(
      en.photographerDashboard.photosUploadedThisMonth.toLowerCase(),
    );
    expect(es.photographerDashboard.photosUploaded).not.toBe(
      es.photographerDashboard.photosUploadedThisMonth.toLowerCase(),
    );
  });
});
