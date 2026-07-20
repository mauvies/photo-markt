import { once } from 'node:events';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { describe, expect, it } from 'vitest';

/**
 * Contract test for the archiver behaviors the ZIP download route
 * (`/api/events/[id]/download`) depends on, pinned across the v7 → v8 major
 * (T-154). The route has no other automated coverage of its archiver usage,
 * so this drives the library with the route's exact call shape:
 *
 *   1. `new ZipArchive({ store: true })` — v8 replaced the callable default
 *      factory (`archiver('zip', opts)`) with named classes; this test is
 *      what caught that undocumented break during the upgrade.
 *   2. `append(buffer, { name })` emits an `'entry'` event per entry — the
 *      route awaits it between photos as its backpressure mechanism (peak
 *      memory ≈ one original); a renamed/removed event would silently break
 *      that.
 *   3. The archive is a Node Readable that `Readable.toWeb` can stream, and
 *      the bytes form a valid ZIP: local-file-header magic, both entry
 *      names, end-of-central-directory record, and (because `store` means
 *      no deflate) the raw file bytes verbatim.
 */

async function collectWebStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe('archiver zip contract (T-154, route /api/events/[id]/download)', () => {
  it("streams a valid stored ZIP and emits 'entry' per append", async () => {
    const archive = new ZipArchive({ store: true });
    const errors: unknown[] = [];
    archive.on('error', (err) => errors.push(err));

    // Start collecting before appending, exactly like the route (the
    // Response streams while the async builder appends).
    const collected = collectWebStream(Readable.toWeb(archive) as ReadableStream<Uint8Array>);

    const fileA = Buffer.from('first photo bytes');
    const fileB = Buffer.from('second photo bytes');

    // Route's backpressure shape: append, then await the 'entry' event.
    let entryProcessed = once(archive, 'entry');
    archive.append(fileA, { name: 'photo-a.jpg' });
    await entryProcessed;

    entryProcessed = once(archive, 'entry');
    archive.append(fileB, { name: 'photo-b.jpg' });
    await entryProcessed;

    await archive.finalize();
    const zip = await collected;

    expect(errors).toEqual([]);
    // Local file header magic at byte 0.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from('PK\x03\x04', 'binary'));
    // End-of-central-directory record present (valid, finalized ZIP).
    expect(zip.includes(Buffer.from('PK\x05\x06', 'binary'))).toBe(true);
    // Both entries present by name.
    expect(zip.includes(Buffer.from('photo-a.jpg'))).toBe(true);
    expect(zip.includes(Buffer.from('photo-b.jpg'))).toBe(true);
    // `store: true` → no deflate → raw bytes appear verbatim.
    expect(zip.includes(fileA)).toBe(true);
    expect(zip.includes(fileB)).toBe(true);
  });
});
