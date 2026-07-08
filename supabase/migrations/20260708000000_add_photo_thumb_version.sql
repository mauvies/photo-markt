-- T-078: cache-bust thumbnails when a face-blur re-bake overwrites an
-- already-cached, content-addressed /api/thumb URL.
--
-- The thumbnail URL is content-addressed by the photo's storage path and served
-- with `immutable, max-age=1y`, so a re-bake (AI enabled AFTER upload / re-index)
-- writes the blurred thumbnail to the SAME URL — the CDN/browser keep serving the
-- stale, unblurred copy for up to a year. `thumb_version` is bumped on every
-- successful bake and threaded into the URL as `?v=N`, so a re-bake produces a
-- fresh CDN cache key while unchanged photos keep their cached (v=0 → no param)
-- URL, preserving the egress win.
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumb_version integer NOT NULL DEFAULT 0;
