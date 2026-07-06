/**
 * Watermark tile generator.
 *
 * Produces the repeating "Photo Markt" tile that `lib/watermark.ts` composites
 * over every preview/thumbnail. The tile is generated from config here (text,
 * sizes, opacity, angle, lattice density) instead of hand-drawn, and is
 * rendered to a PNG via Sharp's SVG support.
 *
 * The pattern is a **regular diagonal mosaic**: labels sit on a fixed lattice
 * (spacing divides the tile so the raster repeats seamlessly), all rotated at
 * the same angle. Size follows a deliberate checkerboard rhythm — every other
 * cell is the larger, symbol-bearing "Photo Markt" label, the rest a smaller
 * plain one — so the pattern has visual rhythm without any randomness. The
 * brand symbol is a small monochrome camera glyph drawn with fill-only
 * primitives (no stroked outlines, no fonts) so it rasterizes identically
 * everywhere.
 *
 * NOTE: this tile carries brand text only. Interleaving each photographer's
 * name/handle (T-067's stretch goal) needs per-photographer dynamic text, which
 * means runtime font rendering — deliberately deferred to a follow-up ticket
 * because the pipeline bakes a single static PNG precisely to avoid runtime
 * fontconfig on Vercel's serverless runtime (see lib/watermark.ts).
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
  /** Watermark text (brand). */
  text: string;
  /** Tile is square; this is its side length in px. */
  tileSize: number;
  /** Font size (px) of the larger, symbol-bearing label in the size rhythm. */
  fontSizeLarge: number;
  /** Font size (px) of the smaller plain label in the size rhythm. */
  fontSizeSmall: number;
  /** Rotation of the labels, in degrees (negative = up to the right). */
  angleDeg: number;
  /** Per-glyph opacity, 0–1. Overlaps read slightly stronger. */
  opacity: number;
  /** Text color (any CSS/SVG color). */
  color: string;
  /**
   * Outer stroke width (px) on each text glyph. Thickens the text edges so AI
   * watermark removers — which exploit thin, low-contrast lines — can't render
   * the mark out cleanly. 0 disables.
   */
  strokeWidth: number;
  /**
   * Lattice columns across the tile. Spacing = tileSize / cols, so the raster
   * repeats seamlessly. Must be even so the checkerboard rhythm and the
   * half-cell brick offset stay periodic across the tile seam.
   */
  cols: number;
  /** Lattice rows down the tile. Spacing = tileSize / rows; must be even. */
  rows: number;
  /** Letter spacing in px. */
  letterSpacing: number;
  /** Font stack; resolved at generation time, baked into the raster. */
  fontFamily: string;
  /** Draw the brand camera glyph next to the larger labels. */
  symbol: boolean;
  /**
   * Dark drop-shadow rendered behind each glyph so the white text stays legible
   * over bright/busy photos (pure white at any opacity vanishes on light areas).
   * Set to `null` to disable.
   */
  shadow: { color: string; opacity: number; offsetX: number; offsetY: number } | null;
}

export const DEFAULT_WATERMARK_TILE_CONFIG: WatermarkTileConfig = {
  text: 'Photo Markt',
  tileSize: 540,
  fontSizeLarge: 24,
  fontSizeSmall: 16,
  angleDeg: -30,
  opacity: 0.5,
  color: '#ffffff',
  strokeWidth: 1,
  cols: 4,
  rows: 6,
  letterSpacing: 2,
  fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
  symbol: true,
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

/** Positive modulo — keeps the brick offset / parity periodic for negative rows. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export interface WatermarkCell {
  /** Label anchor X (px). */
  x: number;
  /** Label anchor Y (px). */
  y: number;
  /** Which size bucket this cell renders in — drives the deliberate rhythm. */
  size: 'large' | 'small';
  /** Large cells carry the brand symbol; small cells are text-only. */
  withSymbol: boolean;
}

/**
 * Pure geometry for the regular diagonal mosaic: place labels on a fixed
 * lattice (spacing = tileSize / cols|rows) with a half-cell brick offset on
 * alternate rows, and assign size by (row + col) parity so large and small
 * labels alternate in a checkerboard — a deliberate, repeatable rhythm, never
 * random. One extra ring of cells is emitted on every side so labels that rotate
 * past the tile edge have their wrapped copy already drawn, keeping the raster
 * seamless when Sharp tiles it.
 *
 * Exported for unit testing — this is the logic that defines "regular".
 */
export function watermarkLatticeCells(config?: Partial<WatermarkTileConfig>): WatermarkCell[] {
  const c = { ...DEFAULT_WATERMARK_TILE_CONFIG, ...config };
  const stepX = c.tileSize / c.cols;
  const stepY = c.tileSize / c.rows;

  const cells: WatermarkCell[] = [];
  // -1..rows (and cols) inclusive: the extra ring supplies the seam wrap copies.
  for (let row = -1; row <= c.rows; row++) {
    const brick = mod(row, 2) * (stepX / 2);
    for (let col = -1; col <= c.cols; col++) {
      const isLarge = mod(row + col, 2) === 0;
      cells.push({
        x: col * stepX + brick,
        y: row * stepY,
        size: isLarge ? 'large' : 'small',
        withSymbol: isLarge,
      });
    }
  }
  return cells;
}

/**
 * Build the brand camera glyph as fill-only primitives (no strokes, no fonts):
 * a rounded-square body with a dark lens well and a white catchlight. Echoes the
 * app's rounded-square logo mark while staying legible at watermark scale and
 * rasterizing identically everywhere. A rich full-logo asset could replace this
 * later without touching the lattice.
 */
function buildSymbol(
  x: number,
  y: number,
  size: number,
  color: string,
  opacity: number,
  lensColor: string,
): string {
  const bodyH = size * 0.82;
  const r = size * 0.22;
  const lensCx = x + size / 2;
  const lensCy = y + bodyH / 2;
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${bodyH}" rx="${r}" ry="${r}" ` +
    `fill="${color}" fill-opacity="${opacity}"/>` +
    `<circle cx="${lensCx}" cy="${lensCy}" r="${size * 0.26}" fill="${lensColor}" fill-opacity="${opacity}"/>` +
    `<circle cx="${lensCx}" cy="${lensCy}" r="${size * 0.11}" fill="${color}" fill-opacity="${opacity}"/>`
  );
}

/**
 * Build the SVG markup for one watermark tile. Pure and deterministic — exposed
 * separately so it can be unit-tested without rasterizing.
 */
export function buildWatermarkTileSvg(config?: Partial<WatermarkTileConfig>): string {
  const c = { ...DEFAULT_WATERMARK_TILE_CONFIG, ...config };
  const text = escapeXml(c.text);
  const lensColor = c.shadow ? c.shadow.color : '#000000';

  let body = '';
  for (const cell of watermarkLatticeCells(c)) {
    const fontSize = cell.size === 'large' ? c.fontSizeLarge : c.fontSizeSmall;
    const font =
      `font-family="${c.fontFamily}" font-size="${fontSize}" ` +
      `font-weight="700" letter-spacing="${c.letterSpacing}"`;
    // Rotate the whole cell (symbol + shadow + text) about the label anchor so
    // the symbol stays inline with the rotated text and the shadow keeps a fixed
    // offset behind the white glyphs.
    body += `<g transform="rotate(${c.angleDeg} ${cell.x} ${cell.y})">`;
    if (cell.withSymbol && c.symbol) {
      const symSize = fontSize * 0.9;
      // Sit the glyph just left of the text, vertically centered on the cap line.
      body += buildSymbol(
        cell.x - symSize - fontSize * 0.35,
        cell.y - fontSize * 0.78,
        symSize,
        c.color,
        c.opacity,
        lensColor,
      );
    }
    if (c.shadow) {
      body +=
        `<text x="${cell.x + c.shadow.offsetX}" y="${cell.y + c.shadow.offsetY}" ${font} ` +
        `fill="${c.shadow.color}" fill-opacity="${c.shadow.opacity}">${text}</text>`;
    }
    const stroke =
      c.strokeWidth > 0
        ? ` stroke="${c.color}" stroke-width="${c.strokeWidth}" stroke-opacity="${c.opacity}"`
        : '';
    body += `<text x="${cell.x}" y="${cell.y}" ${font} fill="${c.color}" fill-opacity="${c.opacity}"${stroke}>${text}</text>`;
    body += '</g>';
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
