/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PhotoMoreMenu } from '@/components/photo-more-menu';

// Radix's dropdown primitive expects a few DOM APIs happy-dom doesn't ship.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  for (const fn of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(fn in Element.prototype)) {
      // biome-ignore lint/suspicious/noExplicitAny: minimal test polyfill
      (Element.prototype as any)[fn] = () => false;
    }
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const labels = {
  trigger: 'More options',
  download: 'Download',
  share: 'Share',
};

describe('PhotoMoreMenu', () => {
  it('renders the Download item when the download is available', () => {
    render(
      <PhotoMoreMenu
        photoId="p1"
        labels={labels}
        open
        onOpenChange={vi.fn()}
        onDownload={vi.fn()}
        onShare={vi.fn()}
        downloadDisabled={false}
      />,
    );
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('hides the Download item entirely when the download is unavailable', () => {
    // Regression: an unavailable download used to render greyed-out/disabled.
    // It must now be omitted, not shown disabled.
    render(
      <PhotoMoreMenu
        photoId="p1"
        labels={labels}
        open
        onOpenChange={vi.fn()}
        onDownload={vi.fn()}
        onShare={vi.fn()}
        downloadDisabled
      />,
    );
    expect(screen.queryByText('Download')).toBeNull();
    // Other items are unaffected — the menu still renders.
    expect(screen.getByText('Share')).toBeTruthy();
  });
});
