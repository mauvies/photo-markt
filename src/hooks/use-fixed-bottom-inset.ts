'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Measures how many pixels a fixed bottom bar covers at the bottom of the
 * viewport, so the scrolling content above it can reserve exactly that much
 * room and its last item is always reachable.
 *
 * ⚠️ Why measured and not a padding constant: both cart layouts pinned a
 * hand-picked `pb-*` under a fixed checkout bar whose height they don't
 * control. That bar carries the totals (a variable number of rows — subtotal,
 * volume discount, service fee, total), an optional next-tier nudge, a
 * multi-line legally-required consent sentence that wraps differently per
 * locale and per font size, and the CTA. The constant was ALWAYS going to be
 * wrong, and it was: the guest cart reserved 80px for a bar measuring 213px on
 * a 390px-wide viewport, so from the third photo on the items simply could not
 * be scrolled to.
 *
 * The inset is taken from the viewport bottom (`innerHeight - rect.top`), not
 * from the bar's own height, so it also covers whatever the bar is stacked
 * above — the talent dashboard's bottom nav and its safe-area inset — without
 * the caller restating that offset.
 *
 * Returns 0 whenever the bar isn't rendered (`md:hidden` on desktop collapses
 * it to a zero-height rect), so the desktop layout reserves nothing.
 *
 * ⚠️ `ref` is a CALLBACK ref, not a `useRef` object, and that is load-bearing:
 * both carts return a hydration skeleton before they ever render the bar, so on
 * mount there is nothing to measure. A `useRef` + mount-only effect would bail
 * out at that point and never observe anything — the inset would stay 0 for the
 * life of the page, which is the exact bug this hook exists to fix. A callback
 * ref re-runs the effect when the bar actually appears.
 */
export function useFixedBottomInset<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [inset, setInset] = useState(0);

  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) {
      setInset(0);
      return;
    }

    const measure = () => {
      const rect = node.getBoundingClientRect();
      // `display: none` (the desktop breakpoint) reports a zero-height rect at
      // the origin — without this guard that reads as "covers the whole screen".
      const next = rect.height === 0 ? 0 : Math.max(0, Math.ceil(window.innerHeight - rect.top));
      setInset((prev) => (prev === next ? prev : next));
    };

    measure();

    // The bar resizes on its own: the consent text rewraps, the discount row
    // appears, the next-tier nudge comes and goes.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(node);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [node]);

  return { ref, inset };
}
