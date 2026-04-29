'use client';

import { useMemo } from 'react';
import type { SalesByDate } from '@/database/queries/sales';

interface PerformanceChartProps {
  data: SalesByDate[];
  emptyMessage?: string;
  lang?: string;
}

export function PerformanceChart({ data, emptyMessage, lang = 'en' }: PerformanceChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) {
      return { maxRevenue: 100, points: [] };
    }

    const maxRevenue = Math.max(...data.map((d) => d.revenue_cents), 100);

    const points = data.map((item, index) => {
      const [year, month, day] = item.date.split('-').map(Number);
      const date = new Date(year, (month ?? 1) - 1, day ?? 1);
      const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
      const y = 100 - (item.revenue_cents / maxRevenue) * 100;

      return {
        x,
        y: Math.max(y, 0),
        revenue: item.revenue_cents,
        date,
        salesCount: item.sales_count,
      };
    });

    return { maxRevenue, points };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-muted/40">
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? 'No sales data available for the last 30 days'}
        </p>
      </div>
    );
  }

  const { maxRevenue, points } = chartData;

  const pathData =
    points.length > 0
      ? points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
      : '';

  // Only draw area fill when there are multiple points (single point area is invisible)
  const areaPath =
    points.length > 1 ? `${pathData} L ${points[points.length - 1]?.x ?? 0} 100 L 0 100 Z` : '';

  return (
    <div className="relative h-64 w-full">
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 flex h-full flex-col justify-between text-xs text-muted-foreground pr-2">
        <span>
          {new Intl.NumberFormat(lang, {
            style: 'currency',
            currency: 'USD',
            notation: 'compact',
          }).format(maxRevenue / 100)}
        </span>
        <span>$0</span>
      </div>

      {/* Chart area with padding for labels */}
      <div className="ml-12 mr-0 h-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-label="Sales performance chart"
        >
          <title>Sales Performance Over Time</title>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-muted/20"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill="currentColor" className="text-primary/10" />}

          {/* Line */}
          {points.length > 1 && (
            <path
              d={pathData}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-primary"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Data points */}
          {points.map((point) => (
            <circle
              key={`${point.x}-${point.y}-${point.revenue}`}
              cx={point.x}
              cy={point.y}
              r="1.5"
              fill="currentColor"
              className="text-primary"
            />
          ))}
        </svg>
      </div>

      {/* X-axis labels */}
      <div className="absolute bottom-0 left-12 right-0 flex justify-between text-xs text-muted-foreground">
        {points.length > 0 && (
          <>
            <span>
              {points[0]?.date.toLocaleDateString(lang, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            {points.length > 1 && (
              <span>
                {points[points.length - 1]?.date.toLocaleDateString(lang, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
