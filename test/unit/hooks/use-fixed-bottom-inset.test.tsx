/** @vitest-environment happy-dom */
/**
 * Regression (⚠️ blocking): both carts reserved a hand-picked `pb-*` under a
 * fixed checkout bar whose height they don't control — the guest cart reserved
 * 80px for a bar well over twice that. With 3+ photos the items from the third
 * on sat behind the bar and could not be scrolled to at all.
 *
 * The bar's height is inherently variable: a variable number of totals rows
 * (subtotal / volume discount / service fee / total), an optional next-tier
 * nudge, and a legally-required consent sentence that wraps differently per
 * locale and font size. So the reserved space has to be MEASURED.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFixedBottomInset } from '@/hooks/use-fixed-bottom-inset';

let resizeCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(cb: () => void) {
    resizeCallback = cb;
  }
  observe() {}
  disconnect() {
    resizeCallback = null;
  }
}

/** Pretend the fixed bar occupies the bottom `height` px of the viewport. */
function stubBarRect({ height, viewport = 800 }: { height: number; viewport?: number }) {
  window.innerHeight = viewport;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: viewport - height,
    bottom: viewport,
    height,
    width: 400,
    left: 0,
    right: 400,
    x: 0,
    y: viewport - height,
    toJSON: () => ({}),
  } as DOMRect);
}

function Harness({ barMounted = true }: { barMounted?: boolean }) {
  const { ref, inset } = useFixedBottomInset<HTMLDivElement>();
  return (
    <>
      {barMounted ? <div ref={ref} data-testid="bar" /> : null}
      <div data-testid="spacer" style={{ height: inset }} />
    </>
  );
}

beforeEach(() => {
  resizeCallback = null;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useFixedBottomInset', () => {
  it('reserves the full height the bar covers at the bottom of the viewport', () => {
    stubBarRect({ height: 236 });
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('spacer').style.height).toBe('236px');
  });

  it('measures from the viewport bottom, so a bar stacked above the nav reserves both', () => {
    // The talent cart's bar sits at `bottom: 4rem + safe-area`, i.e. it starts
    // higher up the screen than its own height — `innerHeight - top` covers the
    // bar AND the bottom nav underneath it.
    window.innerHeight = 800;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 700,
      height: 200,
      width: 400,
      left: 0,
      right: 400,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    } as DOMRect);

    const { getByTestId } = render(<Harness />);
    expect(getByTestId('spacer').style.height).toBe('300px');
  });

  it('reserves nothing on desktop, where the bar is display:none', () => {
    // `md:hidden` collapses the bar to a zero-height rect at the origin —
    // read naively that says "covers the entire screen".
    stubBarRect({ height: 0 });
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('spacer').style.height).toBe('0px');
  });

  it('re-measures when the bar grows — a discount row, a longer consent wrap', () => {
    stubBarRect({ height: 200 });
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('spacer').style.height).toBe('200px');

    stubBarRect({ height: 268 });
    act(() => resizeCallback?.());
    expect(getByTestId('spacer').style.height).toBe('268px');
  });

  // ⚠️ The real-world path, and the one a `useRef` + mount-only effect gets
  // wrong: both carts render a hydration skeleton first, so on mount there is
  // no bar to measure. Caught in the browser — the spacer sat at 0px under a
  // 213px bar, i.e. the bug this hook exists to fix, still present.
  it('measures a bar that only mounts after the first render', () => {
    stubBarRect({ height: 213, viewport: 844 });
    const { getByTestId, rerender } = render(<Harness barMounted={false} />);
    expect(getByTestId('spacer').style.height).toBe('0px');

    rerender(<Harness barMounted />);
    expect(getByTestId('spacer').style.height).toBe('213px');
  });

  it('releases the reservation when the bar unmounts', () => {
    stubBarRect({ height: 213, viewport: 844 });
    const { getByTestId, rerender } = render(<Harness barMounted />);
    expect(getByTestId('spacer').style.height).toBe('213px');

    rerender(<Harness barMounted={false} />);
    expect(getByTestId('spacer').style.height).toBe('0px');
  });

  it('survives an environment with no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    stubBarRect({ height: 180 });
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('spacer').style.height).toBe('180px');
  });
});
