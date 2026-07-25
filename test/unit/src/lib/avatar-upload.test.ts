import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES } from '@/lib/avatar-constants';
import {
  AVATAR_EDGE_PX,
  avatarObjectPathToDelete,
  buildAvatarPath,
  resizeAvatar,
  validateAvatarUpload,
} from '@/lib/avatar-upload';

let png: Buffer;
let gif: Buffer;

beforeAll(async () => {
  const base = { create: { width: 4, height: 4, channels: 3 as const, background: 'red' } };
  png = await sharp(base).png().toBuffer();
  gif = await sharp(base).gif().toBuffer();
});

function fileFrom(buffer: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buffer)], name, { type });
}

describe('validateAvatarUpload (T-182)', () => {
  it('accepts a real PNG (magic-byte detected)', async () => {
    const result = await validateAvatarUpload(fileFrom(png, 'a.png', 'image/png'));
    expect(result.contentType).toBe('image/png');
  });

  it('rejects a non-image even when the client MIME claims image/png', async () => {
    const notImage = fileFrom(Buffer.from('this is not an image'), 'evil.png', 'image/png');
    await expect(validateAvatarUpload(notImage)).rejects.toThrow(/not a valid image/i);
  });

  it('rejects a format outside the avatar allow-list (GIF — allowed for photos, not avatars)', async () => {
    await expect(validateAvatarUpload(fileFrom(gif, 'a.gif', 'image/gif'))).rejects.toThrow(
      /unsupported image format/i,
    );
  });

  it('rejects an oversized file with the avatar cap (8 MB), before any decode', async () => {
    const tooBig = new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    await expect(validateAvatarUpload(tooBig)).rejects.toThrow(/too large/i);
  });
});

describe('resizeAvatar (T-182)', () => {
  it('re-encodes to a square WebP at the avatar edge size', async () => {
    const out = await resizeAvatar(png);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(AVATAR_EDGE_PX);
    expect(meta.height).toBe(AVATAR_EDGE_PX);
  });
});

describe('buildAvatarPath (T-182)', () => {
  it('scopes the object to the user folder and ends in .webp', () => {
    const path = buildAvatarPath('user-123');
    expect(path.startsWith('user-123/')).toBe(true);
    expect(path.endsWith('.webp')).toBe(true);
  });
});

describe('avatarObjectPathToDelete (T-182) — delete-on-replace safety', () => {
  const base = 'http://127.0.0.1:54321/storage/v1/object/public/avatars';

  it('returns the object path for our bucket under the user folder', () => {
    expect(avatarObjectPathToDelete(`${base}/user-1/abc.webp`, 'user-1')).toBe('user-1/abc.webp');
  });

  it('returns null for a Google OAuth avatar URL (not ours)', () => {
    expect(
      avatarObjectPathToDelete('https://lh3.googleusercontent.com/a/xyz=s96-c', 'user-1'),
    ).toBeNull();
  });

  it('returns null when the object belongs to a DIFFERENT user (fail closed)', () => {
    expect(avatarObjectPathToDelete(`${base}/user-2/abc.webp`, 'user-1')).toBeNull();
  });

  it('returns null for null / empty input', () => {
    expect(avatarObjectPathToDelete(null, 'user-1')).toBeNull();
    expect(avatarObjectPathToDelete('', 'user-1')).toBeNull();
  });
});
