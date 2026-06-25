/**
 * Thin wrapper around AWS Rekognition v3 `DetectText` for race bib numbers.
 *
 * Race bibs are short tokens, so we key off WORD-level detections (not LINE).
 * This module is pure I/O against AWS — no DB writes, no Supabase imports, and
 * no filtering logic (that lives in the pure `extractBibCandidates` helper in
 * `src/lib/bib-numbers.ts`, so it stays unit-testable without AWS).
 *
 * Image bytes must already be prepared by `prepareImageForRekognition`.
 */

import { DetectTextCommand } from '@aws-sdk/client-rekognition';
import { getRekognitionClient } from './rekognition-client';

export interface DetectedText {
  text: string;
  confidence: number;
  boundingBox: Record<string, number> | null;
}

export interface DetectTextForPhotoParams {
  photoBytes: Buffer;
}

/**
 * Run DetectText on a single photo and return its WORD detections (text,
 * confidence, bounding box). Returns every word AWS read — filtering down to
 * plausible bib tokens is the caller's job (`extractBibCandidates`).
 */
export async function detectTextForPhoto(
  params: DetectTextForPhotoParams,
): Promise<DetectedText[]> {
  const result = await getRekognitionClient().send(
    new DetectTextCommand({ Image: { Bytes: params.photoBytes } }),
  );

  return (result.TextDetections ?? [])
    .filter((detection) => detection.Type === 'WORD')
    .map((detection): DetectedText | null => {
      const text = detection.DetectedText?.trim();
      if (!text) return null;
      const box = detection.Geometry?.BoundingBox;
      return {
        text,
        confidence: detection.Confidence ?? 0,
        boundingBox: box
          ? {
              Width: box.Width ?? 0,
              Height: box.Height ?? 0,
              Left: box.Left ?? 0,
              Top: box.Top ?? 0,
            }
          : null,
      };
    })
    .filter((detection): detection is DetectedText => detection !== null);
}
