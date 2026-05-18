import { Calendar, DollarSign, Image as ImageIcon, ShoppingBag } from 'lucide-react';
import type { DashboardData } from '../actions';
import { StatCard } from './stat-card';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

interface MetricsRowProps {
  metrics: DashboardData['metrics'];
  t: {
    earningsThisMonth: string;
    salesThisMonth: string;
    photosUploadedThisMonth: string;
    eventsCreatedThisMonth: string;
    vsLastMonth: string;
  };
}

export function MetricsRow({ metrics, t }: MetricsRowProps) {
  const iconClass = 'h-5 w-5 sm:h-6 sm:w-6 text-primary';

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        label={t.earningsThisMonth}
        value={formatCurrency(metrics.earningsCents)}
        icon={<DollarSign className={iconClass} aria-hidden />}
        trend={
          metrics.trend.earningsPct !== null
            ? { pct: metrics.trend.earningsPct, comparisonLabel: t.vsLastMonth }
            : null
        }
      />
      <StatCard
        label={t.salesThisMonth}
        value={metrics.sales.toLocaleString()}
        icon={<ShoppingBag className={iconClass} aria-hidden />}
        trend={
          metrics.trend.salesPct !== null
            ? { pct: metrics.trend.salesPct, comparisonLabel: t.vsLastMonth }
            : null
        }
      />
      <StatCard
        label={t.photosUploadedThisMonth}
        value={metrics.photosUploaded.toLocaleString()}
        icon={<ImageIcon className={iconClass} aria-hidden />}
        trend={
          metrics.trend.photosPct !== null
            ? { pct: metrics.trend.photosPct, comparisonLabel: t.vsLastMonth }
            : null
        }
      />
      <StatCard
        label={t.eventsCreatedThisMonth}
        value={metrics.eventsCreated.toLocaleString()}
        icon={<Calendar className={iconClass} aria-hidden />}
        trend={
          metrics.trend.eventsPct !== null
            ? { pct: metrics.trend.eventsPct, comparisonLabel: t.vsLastMonth }
            : null
        }
      />
    </div>
  );
}
