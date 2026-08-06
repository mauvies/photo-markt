/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscaleImageFile } from '@/lib/image-downscale';

/**
 * T-238. The avatar picker and the face-search selfie modal still send bytes
 * through a Server Action, so they shrink oversized picks first rather than
 * refusing them. The property that matters most here is the failure mode: this
 * helper is best-effort and must NEVER throw or return something unusable, because
 * the caller's size guard (and the server's magic-byte validation) are the real
 * gates. A browser that can't decode the image — HEIC outside Safari, which is a
 * common phone pick — has to fall through with the original file intact.
 */

const bytes = (n: number) => new File([new Uint8Array(n)], 'photo.heic', { type: 'image/heic' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downscaleImageFile', () => {
  it('leaves a file already under the cap untouched', async () => {
    const small = bytes(1024);
    // No decode is even attempted — re-encoding a small image would only cost
    // quality, and transport weight is the whole point.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => {
        throw new Error('should not be called');
      }),
    );

    await expect(downscaleImageFile(small, { maxEdge: 1024, maxBytes: 4096 })).resolves.toBe(small);
  });

  it('returns the original when the browser cannot decode it', async () => {
    const big = bytes(8192);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported format');
      }),
    );

    const result = await downscaleImageFile(big, { maxEdge: 1024, maxBytes: 4096 });
    expect(result).toBe(big);
  });

  it('returns the original when the environment has no createImageBitmap', async () => {
    const big = bytes(8192);
    vi.stubGlobal('createImageBitmap', undefined);

    const result = await downscaleImageFile(big, { maxEdge: 1024, maxBytes: 4096 });
    expect(result).toBe(big);
  });
});
