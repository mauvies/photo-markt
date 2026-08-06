/**
 * Regression tests for T-070 — event cover upload failing with
 * "mime type image/webp is not supported".
 *
 * Root cause was environment drift not captured by any migration: the
 * `photos` bucket carried a restrictive `allowed_mime_types` list (no webp)
 * and `storage.objects` accumulated a divergent, duplicated policy set that a
 * fresh `db reset` recreated — so local/CI/staging never matched production.
 *
 * Migration `20260706000000_reconcile_photos_storage_config.sql` codifies
 * production's canonical state: the `photos` bucket imposes no MIME allow-list
 * (validation is app-side, magic bytes), and only the two owner-scoped
 * delete/update policies remain. Uploads flow through signed URLs and the
 * service-role client, both of which bypass RLS — so no INSERT/SELECT policy
 * is needed for the bucket to work.
 *
 * These tests assert that canonical state:
 *   1. The cover-upload contract: a `.webp` uploads via the service-role
 *      client and the bucket has no MIME restriction. This is the acceptance
 *      criterion for T-070. (Since T-238 the cover's bytes go up through a signed
 *      upload URL rather than the service-role client, but both bypass RLS the
 *      same way, so what this asserts about the bucket is unchanged.)
 *   2. Policy convergence to production: authenticated clients can no longer
 *      write to or read from the `photos` bucket directly. Before the
 *      migration the duplicate `photos_insert_own` / `photos_select_own`
 *      policies allowed it (fail-before); after, RLS denies it (pass-after).
 */

import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createTestUser,
  ensurePhotosBucket,
  resetDatabase,
  signInAs,
} from '../../helpers/supabase-test-client';

async function webpBuffer(): Promise<Buffer> {
  return await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#7788aa' },
  })
    .webp()
    .toBuffer();
}

describe('photos storage config (T-070)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensurePhotosBucket();
  });

  it('lets the service-role client upload a .webp cover (no MIME restriction)', async () => {
    const service = createServiceClient();

    // The bucket must not impose a MIME allow-list — otherwise Storage rejects
    // webp even for the service role, which is exactly the T-070 failure.
    const { data: bucket, error: bucketError } = await service.storage.getBucket('photos');
    expect(bucketError).toBeNull();
    expect(bucket?.allowed_mime_types ?? null).toBeNull();

    const owner = await createTestUser('PHOTOGRAPHER');
    const path = `${owner.id}/${crypto.randomUUID()}/cover-${crypto.randomUUID()}.webp`;
    const { error } = await service.storage
      .from('photos')
      .upload(path, await webpBuffer(), { contentType: 'image/webp', upsert: false });

    expect(error).toBeNull();
  });

  it('denies authenticated clients from writing directly to the photos bucket', async () => {
    // Production has no INSERT policy on `photos`; uploads go through signed
    // URLs / the service role. This is the fail-before/pass-after hook: before
    // the migration the permissive `photos_insert_own` policy allowed this
    // direct write; after, RLS denies it.
    const user = await createTestUser('PHOTOGRAPHER');
    const authed = await signInAs(user.email);

    const path = `${user.id}/${crypto.randomUUID()}.webp`;
    const { error } = await authed.storage
      .from('photos')
      .upload(path, await webpBuffer(), { contentType: 'image/webp', upsert: false });

    expect(error).not.toBeNull();
  });

  it('denies authenticated clients from listing the photos bucket directly', async () => {
    // No SELECT policy on `photos` either — reads happen via signed download
    // URLs. Seed an object as the service role, then confirm the owner cannot
    // list it through an authenticated (RLS-scoped) client.
    const service = createServiceClient();
    const user = await createTestUser('PHOTOGRAPHER');
    const dir = `${user.id}/${crypto.randomUUID()}`;
    const { error: seedError } = await service.storage
      .from('photos')
      .upload(`${dir}/seed.webp`, await webpBuffer(), { contentType: 'image/webp' });
    expect(seedError).toBeNull();

    const authed = await signInAs(user.email);
    const { data } = await authed.storage.from('photos').list(dir);
    expect(data ?? []).toEqual([]);
  });
});
