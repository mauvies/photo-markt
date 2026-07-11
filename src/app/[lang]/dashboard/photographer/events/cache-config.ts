/**
 * Cache configuration for the photographer dashboard events listing.
 *
 * The cached entry embeds signed Supabase cover URLs, so its lifetime must never
 * exceed those URLs' TTL — otherwise a stale entry serves expired (broken) cover
 * images. `expire` is a HARD cutoff equal to `revalidate` (no stale-while-
 * revalidate past it), mirroring every public cache in the app; without it the
 * entry could be served past the 55-min signed-URL window (F-06, caching audit
 * T-083).
 *
 * Invariant (pinned by cache-config.test.ts): `EVENTS_CACHE_LIFE.expire` ≤
 * `SIGNED_URL_TTL`.
 */

/** Sign cover URLs for 55 min so they never expire within the 50-min cache window. */
export const SIGNED_URL_TTL = 60 * 55;

/** `revalidate` = `expire` = 50 min — a hard cutoff safely under SIGNED_URL_TTL. */
export const EVENTS_CACHE_LIFE = { revalidate: 60 * 50, expire: 60 * 50 };
