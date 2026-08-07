/**
 * The aspect ratio of the event card's cover container (T-233).
 *
 * ⚠️ **One constant, two consumers, and they must never drift.** The card paints
 * the cover and `EventCardSkeleton` reserves the space for it; when the two
 * disagree the skeleton reserves one height and the image paints another, which
 * is layout shift on the LCP element of the home and explore pages (T-123/T-124).
 * Before this it was the literal `aspect-[4/3]` typed out in both files and kept
 * in step by hand.
 *
 * ⚠️ **The full Tailwind class must appear literally here.** Tailwind scans the
 * source for complete class strings, so a value assembled by interpolation
 * (`aspect-[${ratio}]`) generates no CSS at all and silently falls back to no
 * ratio — the failure looks like a layout bug, not a build one.
 *
 * Square rather than 4/3: it gives the cover 33% more height on the surface where
 * events are discovered, and crops symmetrically. The container is `object-cover`,
 * so a taller box necessarily crops more off the sides of a landscape photo —
 * that trade is the point of the change, and 1/1 is where the cover gains
 * presence without a wide race shot losing its subject.
 */
export const EVENT_CARD_COVER_ASPECT = 'aspect-[1/1]';
