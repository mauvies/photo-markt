/**
 * Calls the bulk-download API route and triggers the browser to save the
 * returned ZIP. The route enforces every permission check server-side; this
 * helper only moves bytes. Throws with the server's error message on failure.
 *
 * A single ZIP (rather than many loose downloads) is required for mobile —
 * iOS Safari and Android Chrome block/throttle multiple sequential downloads.
 */
export async function downloadEventPhotosZip(eventId: string, photoIds: string[]): Promise<void> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });

  if (!res.ok) {
    let message = 'Download failed';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'event-photos.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
