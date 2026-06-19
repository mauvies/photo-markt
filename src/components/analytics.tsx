import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

/**
 * Vercel Web Analytics (page views / visits) + Speed Insights (Core Web Vitals).
 *
 * Both SDKs no-op outside production — they only load and send beacons on
 * Vercel production deployments — so this is safe to mount unconditionally in
 * dev, tests, and SSR. Kept as a single wrapper so the cookie-consent gating
 * (T-024) can wrap analytics in one place instead of touching the root layout.
 */
export function WebAnalytics() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
