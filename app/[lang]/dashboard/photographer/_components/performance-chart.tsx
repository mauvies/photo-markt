'use client';

import { format, parseISO } from 'date-fns';
import { useState, useTransition } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ChartPoint, DashboardRange } from '../actions';
import { getEarningsSeries } from '../actions';
import { ChartEmpty } from './empty-states';

interface PerformanceChartProps {
  initialSeries: ChartPoint[];
  initialRange: DashboardRange;
  t: {
    title: string;
    subtitle: string;
    range7d: string;
    range30d: string;
    range3m: string;
    earningsLabel: string;
    emptyTitle: string;
    emptyBody: string;
  };
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTick(value: string, range: DashboardRange): string {
  try {
    const date = parseISO(value);
    return range === '3m' ? format(date, 'MMM d') : format(date, 'MMM d');
  } catch {
    return value;
  }
}

export function PerformanceChart({ initialSeries, initialRange, t }: PerformanceChartProps) {
  const [range, setRange] = useState<DashboardRange>(initialRange);
  const [series, setSeries] = useState<ChartPoint[]>(initialSeries);
  const [isPending, startTransition] = useTransition();

  const config = {
    earnings: {
      label: t.earningsLabel,
      color: 'var(--chart-1)',
    },
  } satisfies ChartConfig;

  const handleRangeChange = (next: string) => {
    const nextRange = next as DashboardRange;
    if (nextRange === range) return;
    setRange(nextRange);
    startTransition(async () => {
      const data = await getEarningsSeries(nextRange);
      setSeries(data);
    });
  };

  const hasEnoughData = series.length >= 2;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <header className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold sm:text-lg">{t.title}</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">{t.subtitle}</p>
        </div>
        <Tabs value={range} onValueChange={handleRangeChange} className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-3 sm:w-auto">
            <TabsTrigger value="7d" className="text-xs sm:text-sm">
              {t.range7d}
            </TabsTrigger>
            <TabsTrigger value="30d" className="text-xs sm:text-sm">
              {t.range30d}
            </TabsTrigger>
            <TabsTrigger value="3m" className="text-xs sm:text-sm">
              {t.range3m}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className={cn('relative transition-opacity', isPending ? 'opacity-60' : 'opacity-100')}>
        {hasEnoughData ? (
          <ChartContainer
            config={config}
            className="aspect-auto h-[220px] w-full sm:h-[280px] lg:h-[320px]"
          >
            <AreaChart data={series} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillEarnings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-earnings)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-earnings)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => formatTick(value, range)}
              />
              <YAxis hide domain={[0, 'auto']} />
              <ChartTooltip
                cursor={{ stroke: 'var(--color-earnings)', strokeDasharray: '3 3' }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) =>
                      typeof value === 'string' ? formatTick(value, range) : String(value)
                    }
                    formatter={(value) =>
                      typeof value === 'number' ? formatCurrency(value) : String(value)
                    }
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="earnings"
                stroke="var(--color-earnings)"
                strokeWidth={2}
                fill="url(#fillEarnings)"
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="h-[220px] sm:h-[280px] lg:h-[320px]">
            <ChartEmpty t={{ title: t.emptyTitle, body: t.emptyBody }} />
          </div>
        )}
      </div>
    </section>
  );
}
