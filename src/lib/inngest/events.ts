/**
 * Typed event registry for Inngest. Every `inngest.send(...)` call site
 * picks up these payload shapes via the `Inngest<{ schemas: Events }>`
 * type parameter in `./client.ts`. Renaming an event here flags every
 * call site at compile time.
 *
 * Event names use dotted casing (`photo.uploaded`, `event.ai-matching-enabled`)
 * matching the Inngest convention and the file names under `./functions/`.
 */

export type Events = {
  /**
   * Emitted after a photographer-side upload writes a `photos` row, when
   * the parent event has AI matching enabled and is not flagged as
   * containing minors. Consumed by `index-photo-faces.ts`.
   */
  'photo.uploaded': {
    data: {
      photoId: string;
      eventId: string;
      storagePath: string;
    };
  };

  /**
   * Emitted by `index-photo-faces.ts` once a photo's face indexing has settled
   * to a terminal, non-rejected outcome (indexed, no faces, AI not applicable,
   * or — via onFailure — indexing failed). Consumed by
   * `generate-photo-thumbnails.ts`: chaining thumbnails after indexing means the
   * persisted face boxes are available, so the single immutable thumbnail bake
   * is already face-blurred. Rejected photos are deleted and emit nothing.
   */
  'photo.processed': {
    data: {
      photoId: string;
      eventId: string;
      storagePath: string;
    };
  };

  /**
   * Emitted when a photographer toggles AI matching ON or fires "Re-index
   * event". The backfill function (`backfill-event-indexing.ts`) creates
   * the AWS collection if needed, resets per-photo statuses, and fans out
   * a `photo.uploaded` per photo.
   */
  'event.ai-matching-enabled': {
    data: {
      eventId: string;
      userId: string;
    };
  };

  /**
   * Emitted when a photographer toggles AI matching OFF. The disable
   * function (`disable-event-indexing.ts`) tears down the AWS collection
   * and resets per-photo statuses to `not_applicable`.
   */
  'event.ai-matching-disabled': {
    data: {
      eventId: string;
    };
  };

  /**
   * Emitted on `deleteEventAction`. The cleanup function
   * (`cleanup-on-event-delete.ts`) deletes the AWS collection (photo_faces
   * cascade via FK on photos delete).
   */
  'event.deleted': {
    data: {
      eventId: string;
    };
  };
};
