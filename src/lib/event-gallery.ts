/**
 * Shared constants for the paginated event-detail gallery ("Load more").
 *
 * The event-detail page renders a finite first batch of this size and appends
 * the next batch via a Server Action when the viewer taps "Load more" — instead
 * of loading, signing, and painting every photo up front (a 264-photo event
 * used to mint 264 signed URLs on first paint). See T-060.
 */
export const EVENT_GALLERY_PAGE_SIZE = 50;
