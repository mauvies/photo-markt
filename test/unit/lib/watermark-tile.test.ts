import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildWatermarkTileSvg,
  DEFAULT_WATERMARK_TILE_CONFIG,
  generateWatermarkTile,
  watermarkLatticeCells,
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
  // Anti-AI-removal: thin, low-contrast lines are what watermark removers
  // exploit. Glyphs must carry an outer stroke and composite at >= 0.5 opacity.
  it('renders glyphs with an outer stroke at the configured opacity', () => {
    const svg = buildWatermarkTileSvg();
    expect(DEFAULT_WATERMARK_TILE_CONFIG.opacity).toBeGreaterThanOrEqual(0.5);
    expect(DEFAULT_WATERMARK_TILE_CONFIG.strokeWidth).toBeGreaterThan(0);
    expect(svg).toContain(`stroke-width="${DEFAULT_WATERMARK_TILE_CONFIG.strokeWidth}"`);
    expect(svg).toContain(`stroke-opacity="${DEFAULT_WATERMARK_TILE_CONFIG.opacity}"`);
  });

  it('omits the stroke when strokeWidth is 0', () => {
    expect(buildWatermarkTileSvg({ strokeWidth: 0 })).not.toContain('stroke-width=');
  });

  it('escapes XML metacharacters in the text', () => {
    const svg = buildWatermarkTileSvg({ text: 'A & B </text><rect/>' });
    expect(svg).not.toContain('& B');
    expect(svg).not.toContain('</text><rect/>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;/text&gt;');
  });

  // The brand symbol is a fill-only glyph (no stroked outline, no font) so it
  // rasterizes identically on any runtime. Turning it off removes it entirely.
  it('draws the brand symbol as fill-only shapes on large cells', () => {
    const withSymbol = buildWatermarkTileSvg();
    expect(withSymbol).toContain('<circle');
    expect(withSymbol).toContain('<rect');
    const noSymbol = buildWatermarkTileSvg({ symbol: false });
    expect(noSymbol).not.toContain('<circle');
  });

  // Every label is rotated at the SAME angle — that's what makes the mosaic
  // "regular" instead of the old scattered look. No label may carry a different
  // rotation.
  it('rotates every cell at the single configured angle', () => {
    const svg = buildWatermarkTileSvg({ angleDeg: -30 });
    const rotations = [...svg.matchAll(/rotate\((-?\d+(?:\.\d+)?)\s/g)].map((m) => m[1]);
    expect(rotations.length).toBeGreaterThan(0);
    expect(new Set(rotations)).toEqual(new Set(['-30']));
  });
});

// Regression: the old tile spaced labels at tileSize/1.2 (not a divisor) with a
// single font size and no symbol — an irregular, un-tileable, flat pattern. The
// new pattern is a REGULAR lattice with a deliberate size rhythm. These assert
// the "regular + deliberate rhythm, not random" acceptance criteria directly.
describe('watermarkLatticeCells', () => {
  it('places cells on a regular lattice (spacing divides the tile)', () => {
    const cfg = { tileSize: 540, cols: 4, rows: 6 };
    const cells = watermarkLatticeCells(cfg);
    const stepX = cfg.tileSize / cfg.cols; // 135
    const stepY = cfg.tileSize / cfg.rows; // 90
    // Y anchors land exactly on the vertical lattice; X anchors on the half-step
    // lattice (alternate rows carry a half-cell brick offset).
    for (const c of cells) {
      expect(Number.isInteger(c.y / stepY)).toBe(true);
      expect(Number.isInteger(c.x / (stepX / 2))).toBe(true);
    }
  });

  it('alternates large/small size in a deliberate checkerboard rhythm', () => {
    const cells = watermarkLatticeCells({ tileSize: 540, cols: 4, rows: 6 });
    // Group a single row and confirm size flips every column — regular, not random.
    const oneRow = cells
      .filter((c) => c.y === 0)
      .sort((a, b) => a.x - b.x)
      .map((c) => c.size);
    expect(oneRow.length).toBeGreaterThan(2);
    for (let i = 1; i < oneRow.length; i++) {
      expect(oneRow[i]).not.toBe(oneRow[i - 1]);
    }
    // Both sizes are actually used (rhythm, not a single size).
    expect(cells.some((c) => c.size === 'large')).toBe(true);
    expect(cells.some((c) => c.size === 'small')).toBe(true);
  });

  it('carries the symbol on large cells only', () => {
    for (const c of watermarkLatticeCells()) {
      expect(c.withSymbol).toBe(c.size === 'large');
    }
  });

  it('scales the cell count with the lattice density', () => {
    const sparse = watermarkLatticeCells({ cols: 2, rows: 2 });
    const dense = watermarkLatticeCells({ cols: 6, rows: 6 });
    expect(dense.length).toBeGreaterThan(sparse.length);
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
  // The generated tile must be both meaningfully dense and meaningfully opaque,
  // yet not so dense it ruins the preview (legible-but-not-obtrusive).
  it('renders a visible watermark (dense + opaque, but not muddy)', async () => {
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

    const coverage = nonTransparent / pixels;
    // Far denser than the old 2.4% and far more opaque than the old 43/255...
    expect(coverage).toBeGreaterThan(0.05);
    expect(maxAlpha).toBeGreaterThan(90); // ~35%+ at the strokes
    // ...but still a preview the buyer can evaluate, not a solid wall of ink.
    expect(coverage).toBeLessThan(0.45);
  });

  // Regression: pure white text vanished over bright/busy photos. The dark
  // shadow gives the watermark its own contrast so it reads on light areas.
  // Guard that the tile actually contains dark, non-transparent pixels.
  it('includes a dark shadow for contrast on light backgrounds', async () => {
    const buf = await generateWatermarkTile();
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;

    let darkOpaque = 0;
    for (let i = 0; i < pixels; i++) {
      const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
      if (a > 40 && r < 80 && g < 80 && b < 80) darkOpaque += 1;
    }
    expect(darkOpaque).toBeGreaterThan(0);

    // Disabling the shadow must reduce those dark pixels (proves the assertion
    // above is measuring the shadow, not anti-aliasing of white text).
    const noShadow = await generateWatermarkTile({ shadow: null });
    const { data: d2, info: i2 } = await sharp(noShadow)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let darkNoShadow = 0;
    for (let i = 0; i < i2.width * i2.height; i++) {
      const [r, g, b, a] = [d2[i * 4], d2[i * 4 + 1], d2[i * 4 + 2], d2[i * 4 + 3]];
      if (a > 40 && r < 80 && g < 80 && b < 80) darkNoShadow += 1;
    }
    expect(darkNoShadow).toBeLessThan(darkOpaque);
  });
});
