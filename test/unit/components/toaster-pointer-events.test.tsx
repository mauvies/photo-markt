/** @vitest-environment happy-dom */
/**
 * T-241 — Radix's modal Dialog (`disableOutsidePointerEvents`, the default
 * for `modal={true}`) sets `document.body.style.pointerEvents = 'none'`
 * while open, to make everything outside the dialog unclickable — and
 * re-enables `auto` only on its own layer. The Toaster is a sibling in
 * `[lang]/layout.tsx`, entirely outside Radix's component tree, so with no
 * override it inherits that `none`: while any modal Dialog is open (e.g. the
 * photo detail modal), a click anywhere on a toast — including its "View
 * cart" action — falls through to whatever's visually behind it instead of
 * registering on the toast.
 *
 * Regression: the Toaster's `style` must pin `pointerEvents: 'auto'`, closer
 * to the toast than `body`, so it always wins over the inherited value
 * regardless of whether a Radix modal is currently disabling outside pointer
 * events. Fails before the fix (no override → toasts unclickable under an
 * open modal), passes after.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured: { style?: React.CSSProperties } = {};
vi.mock('sonner', () => ({
  Toaster: (props: { style?: React.CSSProperties }) => {
    captured.style = props.style;
    return null;
  },
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));
vi.mock('@/hooks/use-auth-user', () => ({
  useAuthUser: () => ({ user: null }),
}));

import { Toaster } from '@/components/ui/sonner';

afterEach(() => {
  cleanup();
  captured.style = undefined;
});

describe('Toaster — stays clickable under an open Radix modal (T-241)', () => {
  it('pins pointer-events to auto, overriding the body-level none Radix sets while a modal Dialog is open', () => {
    render(<Toaster />);
    expect(captured.style?.pointerEvents).toBe('auto');
  });
});
