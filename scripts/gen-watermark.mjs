import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 400×400 transparent tile with "PHOTO MARKT" rotated -30° at 17% opacity.
// Generated once locally (where fontconfig works) and committed; runtime
// just composites this PNG over each photo.
const SIZE = 400;
const FONT_SIZE = 36;
const ANGLE = -30;
const OPACITY = 0.17;
const TEXT = 'PHOTO MARKT';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <text x="${SIZE / 2}" y="${SIZE / 2}"
    font-family="Helvetica, Arial, sans-serif"
    font-size="${FONT_SIZE}"
    font-weight="bold"
    fill="white"
    fill-opacity="${OPACITY}"
    text-anchor="middle"
    dominant-baseline="middle"
    transform="rotate(${ANGLE} ${SIZE / 2} ${SIZE / 2})">${TEXT}</text>
</svg>`;
const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(resolve(__dirname, '../public/watermark/watermark-tile.png'), buffer);
console.log(`Wrote ${buffer.length} bytes`);
