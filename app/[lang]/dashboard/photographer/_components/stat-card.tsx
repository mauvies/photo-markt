import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: string;
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{value}</p>
          {trend ? (
            <p
              className={cn(
                'mt-2 inline-flex items-center gap-1 text-xs font-medium',
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-500'
                  : 'text-rose-600 dark:text-rose-500',
              )}
            >
              {isPositive ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {formatTrendPct(trend.pct)}
              <span className="font-normal text-muted-foreground">{trend.comparisonLabel}</span>
            </p>
          ) : sublabel ? (
            <p className="mt-2 text-xs text-muted-foreground">{sublabel}</p>
          ) : null}
        </div>
        <div className="shrink-0 rounded-full bg-primary/10 p-2 sm:p-3">{icon}</div>
      </div>
    </div>
  );
}
