/**
 * Pure filtering of raw text detections down to plausible race bib numbers.
 *
 * AWS `DetectText` returns whatever text it reads — sponsor banners, signage,
 * timing-mat brands — so we must filter to plausible bibs before persisting:
 * a confidence floor, a digit-dominant token pattern, dedupe, and a per-photo
 * cap. Kept free of AWS/DB imports so the rules (the part most likely to need
 * tuning) are cheap to unit-test. See ticket T-032.
 */

/** Detection confidence floor (0-100). Below this, drop the token. */
export const BIB_MIN_CONFIDENCE = 80;

/**
 * What a plausible bib token looks like after normalization: 1-5 digits,
 * optionally a single trailing category letter (e.g. "1432", "23B"). Pure-alpha
 * tokens (sponsor/sign text) are rejected.
 */
export const BIB_PATTERN = /^\d{1,5}[A-Z]?$/;

/** Cap rows persisted per photo, keeping the highest-confidence tokens. */
export const BIB_MAX_PER_PHOTO = 10;

/** Structural input — matches `DetectedText` from `aws/bib-detection` without importing AWS. */
export interface TextDetectionInput {
  text: string;
  confidence: number;
  boundingBox?: Record<string, number> | null;
}

export interface BibCandidate {
  text: string;
  confidence: number;
  boundingBox: Record<string, number> | null;
}

export interface ExtractBibOptions {
  minConfidence?: number;
  pattern?: RegExp;
  maxPerPhoto?: number;
}

/** Trim, strip surrounding punctuation, uppercase — so "#1432." → "1432". */
export function normalizeBibToken(raw: string): string {
  return raw
    .trim()
    .replace(/^[^0-9A-Za-z]+/, '')
    .replace(/[^0-9A-Za-z]+$/, '')
    .toUpperCase();
}

/**
 * Reduce raw detections to the bib tokens worth persisting:
 * 1. drop anything below the confidence floor,
 * 2. normalize and keep only tokens matching the bib pattern,
 * 3. dedupe by token, keeping the highest-confidence instance,
 * 4. sort by confidence desc and cap at `maxPerPhoto`.
 */
export function extractBibCandidates(
  detections: TextDetectionInput[],
  opts: ExtractBibOptions = {},
): BibCandidate[] {
  const minConfidence = opts.minConfidence ?? BIB_MIN_CONFIDENCE;
  const pattern = opts.pattern ?? BIB_PATTERN;
  const maxPerPhoto = opts.maxPerPhoto ?? BIB_MAX_PER_PHOTO;

  const bestByToken = new Map<string, BibCandidate>();

  for (const detection of detections) {
    if (detection.confidence < minConfidence) continue;
    const text = normalizeBibToken(detection.text);
    if (!pattern.test(text)) continue;

    const existing = bestByToken.get(text);
    if (!existing || detection.confidence > existing.confidence) {
      bestByToken.set(text, {
        text,
        confidence: detection.confidence,
        boundingBox: detection.boundingBox ?? null,
      });
    }
  }

  return [...bestByToken.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxPerPhoto);
}
