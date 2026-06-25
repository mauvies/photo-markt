/**
 * Which top-level view the talent cart renders, given the merge state and how
 * many items the authenticated cart currently holds.
 *
 * `merging` takes priority over everything: while a guest→authenticated cart
 * merge is in flight we must show the skeleton even when the authenticated cart
 * *already* has items — otherwise the pre-merge items paint first and the guest
 * items pop in on top (the "partial → complete" flash this guards against). See
 * ticket T-039.
 */
export type CartView = 'merging' | 'empty' | 'list';

export function cartView(isMerging: boolean, itemCount: number): CartView {
  if (isMerging) return 'merging';
  if (itemCount === 0) return 'empty';
  return 'list';
}
