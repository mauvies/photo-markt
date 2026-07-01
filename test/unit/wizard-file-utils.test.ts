import { describe, expect, it, vi } from 'vitest';
import {
  mergeFilePreviews,
  removeFileFromPreviews,
} from '@/app/[lang]/dashboard/photographer/events/new/wizard-file-utils';
import type { FilePreview } from '@/app/[lang]/dashboard/photographer/events/new/wizard-types';

function makeFile(name: string, size = 100, lastModified = 1000): File {
  const blob = new Blob(['x'.repeat(size)], { type: 'image/jpeg' });
  const file = new File([blob], name, { type: 'image/jpeg', lastModified });
  return file;
}

function makePreview(file: File, url: string): FilePreview {
  return { id: `preview-${file.name}-${file.lastModified}`, url, file };
}

describe('mergeFilePreviews', () => {
  it('adds new files and creates a URL for each', () => {
    const createUrl = vi.fn((f: File) => `blob:${f.name}`);
    const file = makeFile('photo.jpg');
    const result = mergeFilePreviews([], [file], createUrl);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(file);
    expect(result[0].url).toBe('blob:photo.jpg');
    expect(createUrl).toHaveBeenCalledOnce();
  });

  it('skips duplicate files and does not create a new URL for them', () => {
    const createUrl = vi.fn((f: File) => `blob:new-${f.name}`);
    const file = makeFile('photo.jpg');
    const existing: FilePreview[] = [makePreview(file, 'blob:original-url')];
    const result = mergeFilePreviews(existing, [file], createUrl);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('blob:original-url');
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('does not change URLs of existing previews when adding a new file', () => {
    const createUrl = vi.fn((f: File) => `blob:new-${f.name}`);
    const file1 = makeFile('photo1.jpg');
    const file2 = makeFile('photo2.jpg');
    const existing: FilePreview[] = [makePreview(file1, 'blob:url-1')];

    const result = mergeFilePreviews(existing, [file2], createUrl);

    expect(result[0].url).toBe('blob:url-1');
    expect(result[1].url).toBe('blob:new-photo2.jpg');
    expect(createUrl).toHaveBeenCalledOnce();
  });
});

describe('removeFileFromPreviews', () => {
  it('removes the target file and revokes its URL', () => {
    const revokeUrl = vi.fn();
    const file = makeFile('photo.jpg');
    const previews: FilePreview[] = [makePreview(file, 'blob:url-1')];

    const result = removeFileFromPreviews(previews, file, revokeUrl);

    expect(result).toHaveLength(0);
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:url-1');
  });

  it('does not revoke or change the URLs of other previews', () => {
    const revokeUrl = vi.fn();
    const file1 = makeFile('photo1.jpg');
    const file2 = makeFile('photo2.jpg');
    const previews: FilePreview[] = [
      makePreview(file1, 'blob:url-1'),
      makePreview(file2, 'blob:url-2'),
    ];

    const result = removeFileFromPreviews(previews, file1, revokeUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('blob:url-2');
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:url-1');
  });

  it('is a no-op when the target file is not in the list', () => {
    const revokeUrl = vi.fn();
    const file1 = makeFile('photo1.jpg');
    const other = makeFile('other.jpg');
    const previews: FilePreview[] = [makePreview(file1, 'blob:url-1')];

    const result = removeFileFromPreviews(previews, other, revokeUrl);

    expect(result).toHaveLength(1);
    expect(revokeUrl).not.toHaveBeenCalled();
  });
});
