import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildWatermarkTileSvg,
  DEFAULT_WATERMARK_TILE_CONFIG,
  generateWatermarkTile,
} from '@/lib/watermark-tile';

describe('buildWatermarkTileSvg', () => {
  it('renders the configured text inside <text> elements', () => {
    const svg = buildWatermarkTileSvg();
    expect(svg).toContain('<svg');
    expect(svg).toContain('<text');
    expect(svg).toContain(DEFAULT_WATERMARK_TILE_CONFIG.text);
  });

  it('uses the configured tile size for the svg canvas', () => {
    const svg = buildWatermarkTileSvg({ tileSize: 512 });
    expect(svg).toContain('width="512"');
    expect(svg).toContain('height="512"');
  });

  // Text is configurable, so it must be XML-escaped — otherwise a value like
  // "</text>" or "&" would produce malformed SVG and the tile would fail to
  // rasterize (or worse, inject markup).
  it('escapes XML metacharacters in the text', () => {
    const svg = buildWatermarkTileSvg({ text: 'A & B </text><rect/>' });
    expect(svg).not.toContain('& B');
    expect(svg).not.toContain('</text><rect/>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;/text&gt;');
  });
});

describe('generateWatermarkTile', () => {
  it('produces a PNG of the configured dimensions', async () => {
    const buf = await generateWatermarkTile();
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(DEFAULT_WATERMARK_TILE_CONFIG.tileSize);
    expect(meta.height).toBe(DEFAULT_WATERMARK_TILE_CONFIG.tileSize);
  });

  // Regression: the original committed tile was a single centered glyph at 17%
  // opacity (~2.4% coverage, max alpha 43) — effectively invisible over photos.
  // The generated tile must be both meaningfully dense and meaningfully opaque.
  it('renders a visible watermark (dense + opaque enough to read)', async () => {
    const buf = await generateWatermarkTile();
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;

    let nonTransparent = 0;
    let maxAlpha = 0;
    for (let i = 0; i < pixels; i++) {
      const a = data[i * 4 + 3];
      if (a > 0) nonTransparent += 1;
      if (a > maxAlpha) maxAlpha = a;
    }

    // Far denser than the old 2.4% and far more opaque than the old 43/255.
    expect(nonTransparent / pixels).toBeGreaterThan(0.05);
    expect(maxAlpha).toBeGreaterThan(90); // ~35%+ at the strokes
  });
});
