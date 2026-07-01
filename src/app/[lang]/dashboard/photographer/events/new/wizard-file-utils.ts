import type { FilePreview } from './wizard-types';

/**
 * Add incoming files to the existing previews array, skipping duplicates.
 * Creates an object URL for each new file via the injected `createUrl`.
 * Existing previews are returned unchanged — their URLs are never touched.
 */
export function mergeFilePreviews(
  existing: FilePreview[],
  incoming: File[],
  createUrl: (file: File) => string,
): FilePreview[] {
  const next = [...existing];
  for (const file of incoming) {
    const isDuplicate = next.some(
      (item) =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified,
    );
    if (!isDuplicate) {
      next.push({
        id: `preview-${file.name}-${file.lastModified}`,
        url: createUrl(file),
        file,
      });
    }
  }
  return next;
}

/**
 * Remove the target file from previews, revoking only its object URL.
 * All other previews are returned unchanged — their URLs are never touched.
 */
export function removeFileFromPreviews(
  previews: FilePreview[],
  target: File,
  revokeUrl: (url: string) => void,
): FilePreview[] {
  const removed = previews.find((p) => p.file === target);
  if (removed) revokeUrl(removed.url);
  return previews.filter((p) => p.file !== target);
}
