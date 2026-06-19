/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAnalytics } from '@/components/analytics';

// Stub the Vercel SDKs so the test asserts the wrapper mounts both, without
// pulling in their production beacon/script behaviour.
vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div data-testid="vercel-web-analytics" />,
}));
vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <div data-testid="vercel-speed-insights" />,
}));

afterEach(cleanup);

describe('WebAnalytics', () => {
  it('mounts both Vercel Web Analytics and Speed Insights', () => {
    render(<WebAnalytics />);
    expect(screen.getByTestId('vercel-web-analytics')).toBeTruthy();
    expect(screen.getByTestId('vercel-speed-insights')).toBeTruthy();
  });
});
