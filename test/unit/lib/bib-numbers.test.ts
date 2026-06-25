import { describe, expect, it } from 'vitest';
import {
  BIB_MIN_CONFIDENCE,
  extractBibCandidates,
  normalizeBibToken,
  type TextDetectionInput,
} from '@/lib/bib-numbers';

const det = (text: string, confidence = 95): TextDetectionInput => ({ text, confidence });

describe('normalizeBibToken', () => {
  it('strips surrounding punctuation/space and uppercases', () => {
    expect(normalizeBibToken('  #1432. ')).toBe('1432');
    expect(normalizeBibToken('23b')).toBe('23B');
  });
});

describe('extractBibCandidates (T-032)', () => {
  it('keeps digit-dominant tokens and discards sponsor/sign text', () => {
    const out = extractBibCandidates([det('ACME'), det('FINISH'), det('1432')]);
    expect(out.map((c) => c.text)).toEqual(['1432']);
  });

  it('discards detections below the confidence floor', () => {
    const out = extractBibCandidates([det('1432', BIB_MIN_CONFIDENCE - 1)]);
    expect(out).toEqual([]);
  });

  it('dedupes a token across detections, keeping the highest confidence', () => {
    const out = extractBibCandidates([det('1432', 82), det('1432', 97)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(97);
  });

  it('accepts a single trailing category letter but rejects pure-alpha', () => {
    const out = extractBibCandidates([det('23B'), det('AB')]);
    expect(out.map((c) => c.text)).toEqual(['23B']);
  });

  it('sorts by confidence desc and caps at maxPerPhoto', () => {
    const out = extractBibCandidates([det('11', 90), det('22', 99), det('33', 95)], {
      maxPerPhoto: 2,
    });
    expect(out.map((c) => c.text)).toEqual(['22', '33']);
  });

  it('rejects tokens longer than the pattern allows (6+ digits)', () => {
    expect(extractBibCandidates([det('123456')])).toEqual([]);
  });

  it('carries the bounding box through', () => {
    const box = { Width: 0.1, Height: 0.1, Left: 0.2, Top: 0.3 };
    const out = extractBibCandidates([{ text: '777', confidence: 99, boundingBox: box }]);
    expect(out[0]?.boundingBox).toEqual(box);
  });
});
