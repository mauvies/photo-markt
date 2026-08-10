import { toast } from 'sonner';

/**
 * Id PREFIX for the "added to cart" toast. Every add gets its own
 * `${ADDED_TO_CART_TOAST_ID}-<n>` id.
 *
 * It used to be a single stable id shared by every add, for two good reasons:
 * rapid re-adds replaced the toast instead of stacking a pile of them, and the
 * replacement always carried a fresh `onViewCart` closure (the fix for "the
 * View cart button sometimes doesn't work" — a stale toast holding an outdated
 * handler).
 *
 * But a same-id toast whose copy is also identical is a NO-OP on screen: adding
 * a second photo re-rendered the same words in the same box, so the toast just
 * sat there looking static and the buyer had no signal that the second add
 * registered. Both original properties are kept below without that cost.
 */
export const ADDED_TO_CART_TOAST_ID = 'added-to-cart';

/** The add-to-cart toast currently on screen, if any. */
let currentToastId: string | null = null;
let sequence = 0;

/** Test seam: reset the module-level toast bookkeeping between cases. */
export function resetAddedToCartToastState() {
  currentToastId = null;
  sequence = 0;
}

/**
 * Fire the "added to cart" toast with a "View cart" action, consistently for
 * both the guest and authenticated flows. The caller supplies the localized
 * copy and the navigation closure so this stays framework-agnostic.
 *
 * Each call dismisses the previous toast and raises a NEW one, so every add
 * replays the enter animation and reads as its own confirmation. Dismissing
 * first is what keeps the old "don't stack" property: at most one add-to-cart
 * toast is ever live, no matter how fast the buyer taps. And a brand-new toast
 * necessarily carries the fresh `onViewCart` closure, so "View cart" can't go
 * stale either.
 */
export function showAddedToCartToast({
  message,
  viewCartLabel,
  onViewCart,
}: {
  message: string;
  viewCartLabel: string;
  onViewCart: () => void;
}) {
  if (currentToastId !== null) toast.dismiss(currentToastId);

  sequence += 1;
  const id = `${ADDED_TO_CART_TOAST_ID}-${sequence}`;
  currentToastId = id;

  // Forget the id once this toast is gone, so a later add doesn't try to
  // dismiss something sonner has already dropped.
  const forget = () => {
    if (currentToastId === id) currentToastId = null;
  };

  toast.success(message, {
    id,
    action: {
      label: viewCartLabel,
      onClick: onViewCart,
    },
    onDismiss: forget,
    onAutoClose: forget,
  });
}
