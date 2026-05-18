-- Cleanup of the abandoned CLIP/Replicate AI matching artifacts (see
-- docs/AI_MATCHING_AUDIT.md). Replaced by AWS Rekognition Collections,
-- which store face embeddings inside AWS — our DB only holds the returned
-- face_id per photo (see 20260518000002_create_photo_faces.sql).

-- Both overloads of search_photos_by_similarity (date + timestamptz).
-- The timestamptz one references columns that don't exist
-- (events.activity_type, events.region, user_profiles) and would fail at
-- runtime if called. The date one was correct but is unused after this PR.
drop function if exists public.search_photos_by_similarity(
  vector, double precision, integer, text, text, text, date, date
);
drop function if exists public.search_photos_by_similarity(
  vector, double precision, integer, text, text, text, timestamptz, timestamptz
);

-- photo_embeddings — HNSW index, embedding column, the lot.
drop table if exists public.photo_embeddings cascade;

-- Hybrid-signal columns introduced on the rewrite branch but never read by
-- the TypeScript on main. Safe to drop because nothing writes to them either.
drop index if exists public.photos_photo_hash_idx;
alter table public.photos drop column if exists photo_hash;
alter table public.photos drop column if exists color_signature;

-- selfie_embedding on ai_search_profiles — the new Model 1 design never
-- stores talent face data; selfies are sent to AWS SearchFacesByImage per
-- request and discarded.
drop index if exists public.ai_search_profiles_embedding_idx;
alter table public.ai_search_profiles drop column if exists selfie_embedding;

-- pgvector extension is left enabled. Low cost, no other tables depend on
-- it today, but we may bring it back later for non-face vector workloads.
