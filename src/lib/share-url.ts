/**
 * Shares a URL via the Web Share API when available, falling back to copying
 * it to the clipboard. Fire-and-forget — callers don't need to await it.
 */
export function shareUrl(title: string, url: string): void {
  if (typeof navigator !== 'undefined' && navigator.share) {
    navigator.share({ title, url }).catch(() => {
      navigator.clipboard?.writeText(url).catch(() => {});
    });
    return;
  }
  if (typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(url).catch(() => {});
  }
}
