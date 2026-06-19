// Client-only helpers for the localStorage list of "photos this browser
// uploaded as a guest", keyed by event share_code. Used by the contribute
// flow to remember tokens after upload and by the public viewer to decide
// which photos can be deleted.

const KEY_PREFIX = 'photo-markt_guest_uploads:';

export type GuestUpload = {
  photoId: string;
  deleteToken: string | null;
};

function key(shareCode: string): string {
  return `${KEY_PREFIX}${shareCode}`;
}

export function readGuestUploads(shareCode: string): GuestUpload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key(shareCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is GuestUpload => {
        return (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as GuestUpload).photoId === 'string' &&
          (typeof (entry as GuestUpload).deleteToken === 'string' ||
            (entry as GuestUpload).deleteToken === null)
        );
      })
      .map((e) => ({ photoId: e.photoId, deleteToken: e.deleteToken }));
  } catch {
    return [];
  }
}

export function appendGuestUploads(shareCode: string, uploads: GuestUpload[]): void {
  if (typeof window === 'undefined' || uploads.length === 0) return;
  try {
    const existing = readGuestUploads(shareCode);
    const byId = new Map<string, GuestUpload>();
    for (const e of existing) byId.set(e.photoId, e);
    for (const u of uploads) byId.set(u.photoId, u);
    window.localStorage.setItem(key(shareCode), JSON.stringify(Array.from(byId.values())));
  } catch {
    // ignore
  }
}

export function removeGuestUpload(shareCode: string, photoId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readGuestUploads(shareCode);
    const next = existing.filter((e) => e.photoId !== photoId);
    if (next.length === 0) {
      window.localStorage.removeItem(key(shareCode));
    } else {
      window.localStorage.setItem(key(shareCode), JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}
