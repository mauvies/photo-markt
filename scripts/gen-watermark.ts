/**
 * Regenerates the committed watermark tile at
 * `public/watermark/watermark-tile.png` from the generator config.
 *
 * Run: `pnpm watermark:gen`
 *
 * Tune the look by editing DEFAULT_WATERMARK_TILE_CONFIG in
 * `lib/watermark-tile.ts` (or pass overrides below), then re-run and commit
 * the regenerated PNG. Runtime never regenerates — it only composites this
 * raster (see lib/watermark-tile.ts for why).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWatermarkTile } from '../lib/watermark-tile';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../public/watermark/watermark-tile.png');

async function main(): Promise<void> {
  const buffer = await generateWatermarkTile();
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
