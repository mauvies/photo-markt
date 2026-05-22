-- Store each photo's displayed pixel dimensions (EXIF-orientation-corrected)
-- so the gallery grid can reserve space and lay out without a layout shift.
-- Nullable: legacy rows carry no dimensions and fall back to a client-side
-- probe in the gallery; new uploads populate these at validation time.
alter table photos
  add column width integer,
  add column height integer;
