ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_status text NOT NULL DEFAULT 'pending';

ALTER TABLE photos
  DROP CONSTRAINT IF EXISTS photos_thumbnail_status_check;
ALTER TABLE photos
  ADD CONSTRAINT photos_thumbnail_status_check
  CHECK (thumbnail_status IN ('pending', 'ready', 'failed'));

-- Partial index: cheap query for photos not yet processed (pending/failed).
-- Omits 'ready' rows so the index stays small as the table grows.
CREATE INDEX IF NOT EXISTS photos_thumbnail_status_idx
  ON photos (thumbnail_status)
  WHERE thumbnail_status <> 'ready';
