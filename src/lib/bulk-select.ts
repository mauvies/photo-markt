/**
 * From a selection of photo ids, keep only the ones not already present in any
 * of the given sets — the "new" ids a bulk action should actually act on. Used
 * by the bulk "Add to favorites" and "Add to cart" handlers so they skip items
 * the user already has (and can report the real count, not the whole
 * selection). Pure so the dedup logic is unit-testable without the component.
 * (T-042)
 */
export function filterNewIds(ids: string[], ...exclude: Set<string>[]): string[] {
  return ids.filter((id) => !exclude.some((set) => set.has(id)));
}
