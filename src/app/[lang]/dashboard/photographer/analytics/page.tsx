import { DashboardHeader } from '@/components/dashboard-header';

export default async function AnalyticsPage() {
  return (
    <div>
      <DashboardHeader title="Analytics" />
      <p className="text-muted-foreground mt-2">Metrics and charts coming soon.</p>
    </div>
  );
}
