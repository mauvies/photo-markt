import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: string;
  /**
   * Secondary line under the value. Rendered **alongside** the trend, not
   * instead of it (T-251): the card whose bug this fixed shows a month count of
   * 0 with `trend === null` (last month was 0 too, so `computePct` gives null),
   * so a sublabel that only appeared in the absence of a trend would have gone
   * missing in exactly the case that needed it.
   */
  sublabel?: string;
  icon: ReactNode;
  trend?: { pct: number; comparisonLabel: string } | null;
}

function formatTrendPct(pct: number): string {
  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  const absStr = Math.abs(rounded).toString();
  return `${sign}${absStr}%`;
}

export function StatCard({ label, value, sublabel, icon, trend }: StatCardProps) {
  const isPositive = trend ? trend.pct >= 0 : false;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <div className="shrink-0 rounded-full bg-primary/10 p-1.5 sm:p-3">{icon}</div>
      </div>
      {trend || sublabel ? (
        <div className="mt-2 space-y-1">
          {trend ? (
            <p
              className={cn(
                'flex flex-wrap items-center gap-x-1 text-xs font-medium',
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-500'
                  : 'text-rose-600 dark:text-rose-500',
              )}
            >
              <span className="inline-flex items-center gap-1">
                {isPositive ? (
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                )}
                {formatTrendPct(trend.pct)}
              </span>
              <span className="font-normal text-muted-foreground">{trend.comparisonLabel}</span>
            </p>
          ) : null}
          {sublabel ? <p className="text-xs text-muted-foreground">{sublabel}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
