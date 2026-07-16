import { toast } from 'sonner';

/**
 * Stable id for the "added to cart" toast. Reusing one id means rapid
 * successive adds *replace* the toast (resetting its timer) instead of stacking
 * a pile of them — and, crucially, the replacement carries a fresh `onViewCart`
 * closure. That's the fix for "the View cart button sometimes doesn't work":
 * the old bug was a stale/dismissed toast holding an outdated handler.
 */
export const ADDED_TO_CART_TOAST_ID = 'added-to-cart';

/**
 * Fire the "added to cart" toast with a "View cart" action, consistently for
 * both the guest and authenticated flows (previously only guests got the
 * button). The caller supplies the localized copy and the navigation closure so
 * this stays framework-agnostic; every call goes through the same stable id.
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
  toast.success(message, {
    id: ADDED_TO_CART_TOAST_ID,
    action: {
      label: viewCartLabel,
      onClick: onViewCart,
    },
  });
}
