/**
 * Standalone "Photos (N)" label for the gallery toolbar's left slot on event
 * views WITHOUT the "All / My photos" tabs (T-104). Mirrors the tab styling so
 * the left slot reads consistently whether it holds tabs or this count. Lives
 * in the toolbar's `leading` slot, so it hides while selecting — same as tabs.
 */
export function EventPhotoCountLabel({ label }: { label: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap text-sm font-medium text-foreground">{label}</span>
  );
}
