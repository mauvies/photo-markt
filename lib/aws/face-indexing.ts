/**
 * Thin wrappers around AWS Rekognition v3 commands.
 *
 * Idempotency: `createCollection` swallows `ResourceAlreadyExistsException`
 * and `deleteCollection` swallows `ResourceNotFoundException` so callers
 * (the Inngest workers) can run them as steps without bespoke error
 * handling for "already done".
 *
 * Image bytes must already be prepared by `prepareImageForRekognition`.
 * This module is pure I/O against AWS — no DB writes, no Supabase imports.
 */

import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';
import { getRekognitionClient } from './rekognition-client';

export interface IndexedFace {
  awsFaceId: string;
  confidence: number;
  boundingBox: Record<string, number> | null;
}

export interface SearchedFace {
  awsFaceId: string;
  similarity: number;
}

/**
 * Create a Rekognition collection. Idempotent — `ResourceAlreadyExistsException`
 * is treated as success because the Inngest backfill function may retry.
 */
export async function createCollection(collectionId: string): Promise<void> {
  try {
    await getRekognitionClient().send(new CreateCollectionCommand({ CollectionId: collectionId }));
  } catch (err) {
    if (isAwsError(err, 'ResourceAlreadyExistsException')) return;
    throw err;
  }
}

/**
 * Delete a Rekognition collection. Idempotent — `ResourceNotFoundException`
 * is treated as success so disable / cleanup flows can be re-run safely.
 */
export async function deleteCollection(collectionId: string): Promise<void> {
  try {
    await getRekognitionClient().send(new DeleteCollectionCommand({ CollectionId: collectionId }));
  } catch (err) {
    if (isAwsError(err, 'ResourceNotFoundException')) return;
    throw err;
  }
}

export interface IndexFaceForPhotoParams {
  collectionId: string;
  photoBytes: Buffer;
  /**
   * AWS keeps this on every face record. We pass our `photos.id` so that
   * even if our `photo_faces` table got out of sync, we could reconstruct
   * the mapping from AWS's side.
   */
  externalImageId: string;
}

/**
 * Run IndexFaces on a single photo. `MaxFaces: 10` lets a group photo
 * surface up to 10 people without runaway results. `QualityFilter: 'AUTO'`
 * lets AWS drop low-quality faces (helmets-half-off etc.) instead of
 * dragging match accuracy down.
 */
export async function indexFaceForPhoto(params: IndexFaceForPhotoParams): Promise<IndexedFace[]> {
  const result = await getRekognitionClient().send(
    new IndexFacesCommand({
      CollectionId: params.collectionId,
      Image: { Bytes: params.photoBytes },
      ExternalImageId: params.externalImageId,
      DetectionAttributes: ['DEFAULT'],
      MaxFaces: 10,
      QualityFilter: 'AUTO',
    }),
  );

  return (result.FaceRecords ?? [])
    .map((record): IndexedFace | null => {
      const face = record.Face;
      if (!face?.FaceId) return null;
      return {
        awsFaceId: face.FaceId,
        confidence: face.Confidence ?? 0,
        boundingBox: face.BoundingBox
          ? {
              Width: face.BoundingBox.Width ?? 0,
              Height: face.BoundingBox.Height ?? 0,
              Left: face.BoundingBox.Left ?? 0,
              Top: face.BoundingBox.Top ?? 0,
            }
          : null,
      };
    })
    .filter((face): face is IndexedFace => face !== null);
}

export interface SearchFacesByImageParams {
  collectionId: string;
  selfieBytes: Buffer;
  /**
   * `FaceMatchThreshold` in AWS terms — 0-100. 80 is a sensible "high
   * precision" default per AWS docs; PR 3 may tune this.
   */
  threshold?: number;
}

/**
 * Run SearchFacesByImage on a talent selfie. Used in PR 3; defined here so
 * the AWS wrapper layer is complete.
 */
export async function searchFacesByImage(
  params: SearchFacesByImageParams,
): Promise<SearchedFace[]> {
  const result = await getRekognitionClient().send(
    new SearchFacesByImageCommand({
      CollectionId: params.collectionId,
      Image: { Bytes: params.selfieBytes },
      FaceMatchThreshold: params.threshold ?? 80,
      MaxFaces: 100,
    }),
  );

  return (result.FaceMatches ?? [])
    .map((match): SearchedFace | null => {
      const id = match.Face?.FaceId;
      if (!id) return null;
      return { awsFaceId: id, similarity: match.Similarity ?? 0 };
    })
    .filter((match): match is SearchedFace => match !== null);
}

export interface DeleteFacesFromCollectionParams {
  collectionId: string;
  faceIds: string[];
}

export async function deleteFacesFromCollection(
  params: DeleteFacesFromCollectionParams,
): Promise<void> {
  if (params.faceIds.length === 0) return;
  await getRekognitionClient().send(
    new DeleteFacesCommand({
      CollectionId: params.collectionId,
      FaceIds: params.faceIds,
    }),
  );
}

/**
 * AWS v3 SDK puts the error code on `.name` (and on `.$metadata.errorCode`
 * in some cases). Match by name — it's stable across SDK versions.
 */
function isAwsError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}
