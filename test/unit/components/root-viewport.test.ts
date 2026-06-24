import { describe, expect, it, vi } from 'vitest';

// Importing the root layout pulls in next/font and the metadata base URL; stub
// the heavy/runtime-only bits so we can assert the static `viewport` export.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '--font-stub', className: 'stub' });
  return { Inter: font, Inter_Tight: font, Geist_Mono: font, Syne: font };
});
vi.mock('@/lib/get-site-url', () => ({ getSiteUrl: () => 'https://example.com' }));

import { viewport } from '@/app/layout';

describe('root viewport (T-043)', () => {
  it('pins the page to 1:1 at device width on load', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
  });

  it('opts into viewport-fit=cover so env(safe-area-inset-*) resolves on iOS', () => {
    // Without this the fixed bottom nav / cart bars pad with a 0 inset and sit
    // off vertically on notched devices.
    expect(viewport.viewportFit).toBe('cover');
  });

  it('leaves user zoom enabled (no maximum-scale / user-scalable lock)', () => {
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).not.toBe(false);
  });
});
