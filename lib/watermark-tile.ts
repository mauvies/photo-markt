/**
 * Watermark tile generator.
 *
 * Produces the repeating "PHOTO MARKT" tile that `lib/watermark.ts` composites
 * over every preview/thumbnail. The tile is generated from config here (text,
 * size, opacity, angle, density) instead of hand-drawn in Canva, and is
 * rendered to a PNG via Sharp's SVG text support.
 *
 * Why generate to a committed PNG instead of at runtime: Sharp's SVG text
 * rendering needs fontconfig, which is reliable locally/CI but not on Vercel's
 * serverless runtime. So we run `pnpm watermark:gen` to bake the tile into
 * `public/watermark/watermark-tile.png`, and the request path only composites
 * that raster — no font resolution in production. Tune the look by editing
 * {@link DEFAULT_WATERMARK_TILE_CONFIG} (or passing overrides) and regenerating.
 */
import sharp from 'sharp';

export interface WatermarkTileConfig {
  /** Watermark text. */
  text: string;
  /** Tile is square; this is its side length in px. */
  tileSize: number;
  /** Font size in px. */
  fontSize: number;
  /** Rotation of the text, in degrees (negative = up to the right). */
  angleDeg: number;
  /** Per-glyph opacity, 0–1. Overlaps read slightly stronger. */
  opacity: number;
  /** Text color (any CSS/SVG color). */
  color: string;
  /**
   * Outer stroke width (px) on each glyph. Thickens the text edges so AI
   * watermark removers — which exploit thin, low-contrast lines — can't render
   * the mark out cleanly. 0 disables.
   */
  strokeWidth: number;
  /** Number of text rows down the tile — higher = denser. */
  rows: number;
  /** Letter spacing in px. */
  letterSpacing: number;
  /** Font stack; resolved at generation time, baked into the raster. */
  fontFamily: string;
  /**
   * Dark drop-shadow rendered behind each glyph so the white text stays legible
   * over bright/busy photos (pure white at any opacity vanishes on light areas).
   * Set to `null` to disable.
   */
  shadow: { color: string; opacity: number; offsetX: number; offsetY: number } | null;
}

export const DEFAULT_WATERMARK_TILE_CONFIG: WatermarkTileConfig = {
  text: 'PHOTO MARKT',
  tileSize: 400,
  fontSize: 25,
  angleDeg: -40,
  opacity: 0.5,
  color: '#ffffff',
  strokeWidth: 1,
  rows: 6,
  letterSpacing: 5,
  fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
  shadow: { color: '#000000', opacity: 0.45, offsetX: 1, offsetY: 1 },
};

/** Escape the five XML metacharacters so arbitrary text can't break the SVG. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the SVG markup for one watermark tile. Pure and deterministic — exposed
 * separately so it can be unit-tested without rasterizing.
 */
export function buildWatermarkTileSvg(config?: Partial<WatermarkTileConfig>): string {
  const c = { ...DEFAULT_WATERMARK_TILE_CONFIG, ...config };
  const text = escapeXml(c.text);
  const rowGap = c.tileSize / c.rows;

  let body = '';
  // Render one extra row top and bottom so rotated glyphs don't clip at edges,
  // and a few copies across each row (with a half-tile brick offset) so the
  // pattern stays continuous when Sharp tiles it.
  for (let row = 0; row < c.rows + 2; row++) {
    const y = row * rowGap - rowGap / 2;
    const brick = (row % 2) * (c.tileSize / 2);
    for (let col = -1; col < 3; col++) {
      const x = brick + (col * c.tileSize) / 1.2;
      const font =
        `font-family="${c.fontFamily}" font-size="${c.fontSize}" ` +
        `font-weight="700" letter-spacing="${c.letterSpacing}"`;
      // Both glyphs rotate around the same pivot (x, y) so the shadow stays
      // a consistent offset behind the white text after rotation.
      const rot = `transform="rotate(${c.angleDeg} ${x} ${y})"`;
      if (c.shadow) {
        body +=
          `<text x="${x + c.shadow.offsetX}" y="${y + c.shadow.offsetY}" ${font} ${rot} ` +
          `fill="${c.shadow.color}" fill-opacity="${c.shadow.opacity}">${text}</text>`;
      }
      const stroke =
        c.strokeWidth > 0
          ? ` stroke="${c.color}" stroke-width="${c.strokeWidth}" stroke-opacity="${c.opacity}"`
          : '';
      body += `<text x="${x}" y="${y}" ${font} ${rot} fill="${c.color}" fill-opacity="${c.opacity}"${stroke}>${text}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.tileSize}" height="${c.tileSize}">${body}</svg>`;
}

/** Render the watermark tile to a transparent PNG buffer. */
export async function generateWatermarkTile(
  config?: Partial<WatermarkTileConfig>,
): Promise<Buffer> {
  return sharp(Buffer.from(buildWatermarkTileSvg(config)))
    .png()
    .toBuffer();
}
