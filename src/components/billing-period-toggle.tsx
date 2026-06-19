'use client';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { BillingPeriod } from '@/lib/plans';

interface BillingPeriodToggleProps {
  value: BillingPeriod;
  onChange: (next: BillingPeriod) => void;
  labels: {
    monthly: string;
    yearly: string;
    /** Badge shown next to "yearly" when active, e.g. "2 months free". */
    badge: string;
  };
  /**
   * Optional aria-label override. Defaults to "Toggle billing period" —
   * works for both the home pricing section and the settings page.
   */
  ariaLabel?: string;
}

/**
 * Shared monthly/yearly billing-period switch. Used by both the home page
 * pricing section and the photographer settings page so the look and
 * behavior stay identical across surfaces. Pure controlled component —
 * caller owns the state.
 */
export function BillingPeriodToggle({
  value,
  onChange,
  labels,
  ariaLabel = 'Toggle billing period',
}: BillingPeriodToggleProps) {
  const isYearly = value === 'yearly';

  return (
    <div className="flex items-center justify-center gap-3">
      <span
        className={
          !isYearly ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'
        }
      >
        {labels.monthly}
      </span>
      <Switch
        checked={isYearly}
        onCheckedChange={(v) => onChange(v ? 'yearly' : 'monthly')}
        aria-label={ariaLabel}
      />
      <span
        className={
          isYearly ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'
        }
      >
        {labels.yearly}
      </span>
      {isYearly && (
        <Badge variant="outline" className="ml-1 text-[11px]">
          {labels.badge}
        </Badge>
      )}
    </div>
  );
}
