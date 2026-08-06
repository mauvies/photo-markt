import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES } from '@/lib/avatar-constants';
import {
  MAX_SERVER_ACTION_UPLOAD_BYTES,
  MAX_SERVER_ACTION_UPLOAD_MB,
  VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES,
} from '@/lib/upload-limits';

/**
 * T-238 regression. A photographer uploading a normal-sized event cover got
 * `FUNCTION_PAYLOAD_TOO_LARGE` — Vercel's own 413, thrown before our code runs and
 * therefore impossible to catch or translate. Root cause: the bytes travelled inside
 * a Server Action, whose body Vercel caps at 4.5 MB regardless of what
 * `next.config.ts` declares.
 *
 * These tests pin the two halves of the fix:
 *   1. every surface that still sends bytes through a Server Action caps itself
 *      BELOW the platform limit (avatar 8 MB → 4 MB, selfie 10 MB → 4 MB);
 *   2. the surfaces that can't (photos, event covers) don't use a Server Action at
 *      all — they PUT to Storage via a signed upload URL.
 *
 * Every numeric assertion below fails against the pre-fix tree.
 */

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Server-Action upload caps stay under the platform limit (T-238)', () => {
  it('leaves headroom below Vercel’s un-raisable 4.5 MB body cap', () => {
    expect(VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES).toBe(4.5 * 1024 * 1024);
    expect(MAX_SERVER_ACTION_UPLOAD_BYTES).toBeLessThan(VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES);
    // The gap absorbs the multipart envelope + the other form fields, which ride
    // in the same body as the image.
    expect(MAX_SERVER_ACTION_UPLOAD_MB).toBe(4);
  });

  it('caps the avatar at the transport limit (was 8 MB — twice what Vercel accepts)', () => {
    expect(MAX_AVATAR_BYTES).toBe(MAX_SERVER_ACTION_UPLOAD_BYTES);
    expect(MAX_AVATAR_BYTES).toBeLessThan(VERCEL_SERVER_ACTION_BODY_LIMIT_BYTES);
  });

  it('caps the face-search selfie at the transport limit, client and server', () => {
    const modal = read('src/components/face-search-modal.tsx');
    expect(modal).toContain('const MAX_SELFIE_BYTES = MAX_SERVER_ACTION_UPLOAD_BYTES;');
    expect(modal).not.toContain('10 * 1024 * 1024');

    const action = read('src/app/[lang]/events/[shareCode]/actions.ts');
    expect(action).toContain('rawFile.size > MAX_SERVER_ACTION_UPLOAD_BYTES');
    expect(action).not.toContain('Maximum size is 10 MB');
  });

  it('tells the user the same number the code enforces', () => {
    for (const locale of ['en', 'es']) {
      const dict = read(`src/dictionaries/${locale}.json`);
      expect(dict).not.toContain('max 10 MB');
      expect(dict).not.toContain('máx. 10 MB');
      expect(dict).toContain(`${MAX_SERVER_ACTION_UPLOAD_MB} MB`);
    }
  });
});

describe('bulk image bytes never cross a Server Action (T-238)', () => {
  it('uploads the event cover straight to Storage, not through the action', () => {
    const uploader = read('src/lib/upload-event-cover.ts');
    // Mint → PUT → attach: the same three steps the photo flow has always used.
    expect(uploader).toContain('createEventCoverUploadUrlAction');
    expect(uploader).toContain("method: 'PUT'");
    expect(uploader).toContain('attachEventCoverAction');

    // Neither cover surface may hand a File to a Server Action any more.
    for (const surface of [
      'src/app/[lang]/dashboard/photographer/events/[id]/edit/edit-event-form.tsx',
      'src/app/[lang]/dashboard/photographer/events/new/wizard.tsx',
    ]) {
      const source = read(surface);
      expect(source).toContain('uploadEventCover');
      expect(source).not.toContain("append('cover'");
      expect(source).not.toContain('uploadEventCoverAction');
    }
  });

  it('keeps the magic-byte validation, moved to after the upload', () => {
    const actions = read('src/app/[lang]/dashboard/photographer/events/new/actions.ts');
    // The action reads the stored object back and validates it...
    expect(actions).toContain('validatePhotoBuffer');
    // ...and a path outside the caller's own event folder is never adopted.
    expect(actions).toContain('coverPathPrefix(userId, eventId)');
  });

  it('stops next.config.ts promising a body size Vercel will not honour', () => {
    const config = read('next.config.ts');
    expect(config).not.toContain("bodySizeLimit: '500mb'");
    expect(config).not.toContain("proxyClientMaxBodySize: '500mb'");
    expect(config).toContain("bodySizeLimit: '4.5mb'");
    // The reason has to survive in the file — the config reads fine either way,
    // and that is precisely how the 500 MB claim went unchallenged for so long.
    expect(config).toContain('4.5 MB');
  });
});
