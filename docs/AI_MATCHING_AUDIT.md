# AI Matching — Audit of existing artifacts

**Audit date:** 2026-05-09
**Working branch:** `main` (current deployed state)
**Reference branch:** `feature/ai-matching-rewrite` (last commit `d6fa174`, 2025-11-28 — six months stale, never merged)

This document inventories what exists in code and database for the AI face/photo matching feature, classifies each artifact's reusability, and infers why the feature was abandoned. **No new architecture is proposed here.**

---

## 0. Executive summary

The AI matching feature exists in three coexisting layers that don't fully agree with each other:

| Layer | State |
|---|---|
| **Frontend** (modal, button, results) | Fully built, gated behind `AI_MATCHING=false` feature flag → renders "Coming soon" |
| **Server actions** (`runAISimilaritySearch`, profile CRUD, rate limit) | Fully wired, callable, but unreachable from the UI today |
| **Embedding provider** | `MockEmbeddingProvider` (deterministic pseudo-random from file hash) — explicitly labeled as inaccurate |
| **Similarity search query** | App-layer cosine similarity in JS over a 1000-row prefetch — does **not** use the pgvector RPC |
| **Database schema (deployed staging)** | Has the *advanced* schema from the rewrite branch: `vector(768)`, `photos.color_signature`, `photos.photo_hash`, working `search_photos_by_similarity` RPC |
| **`feature/ai-matching-rewrite` branch** | Real Replicate CLIP integration + hybrid (hash + color sig + embedding) + backfill script + docs — never merged |

The branch and the deployed schema are partially in sync (DB has the rewrite's columns/types), but the TypeScript on `main` was never updated to match. The feature appears to have been disabled the same day the rewrite branch was opened (2025-11-28).

---

## 1. Embedding provider

### What's on `main`

**File:** `lib/ai/embedding-provider.ts`

- `EmbeddingProvider` interface — clean and reusable (image bytes → number[]).
- `MockEmbeddingProvider` — deterministic pseudo-random vectors keyed off a 100-byte hash of the input. **Not a real embedding.** The class normalizes outputs to unit length so cosine math works downstream.
- `generateImageEmbedding(file)` — entry point used by server actions.
- `getEmbeddingProvider()` — hardcoded to return mock.
- Default dimension: **512**.
- The file's own TODO comments at lines 7, 51, 135 explicitly call out "Replace with actual AI provider".

**Provider used:** none. The mock is the only implementation in `main`.
**Wired up:** yes — server actions call `generateImageEmbedding`, the result is stored as a vector and used for similarity. Just produces meaningless embeddings.

### What's on `feature/ai-matching-rewrite`

The rewrite introduces a real provider and a factory:

- **`lib/ai/replicate-embedding-provider.ts`** (315 lines) — calls Replicate's `andreasjansson/clip-features` model. CLIP ViT-L/14, **768-dimensional** embeddings. Async (start prediction → poll for ~1-60 sec). Pricing: ~$0.00025/image. Handles 429 rate-limit (6 req/min on free tier), 402 (no credit), 401 (bad token).
- **`lib/ai/embedding-factory.ts`** (134 lines) — selects provider by `EMBEDDING_PROVIDER` env var with fallback logic. If `REPLICATE_API_TOKEN` is set and `EMBEDDING_PROVIDER` is unset, defaults to Replicate. Mock dimension is bumped to 768 to match.
- **`lib/ai/embedding-queue.ts`** (63 lines) — singleton rate limiter that paces requests to ~5 req/min to avoid Replicate's 429s.

**Important architectural choice (and likely failure mode):** CLIP is a general-purpose image-text contrastive model. It is **not a face recognition model**. The rewrite's own docs (`docs/AI_EMBEDDINGS_SETUP.md`) implicitly admit this in the troubleshooting section: *"Low Accuracy: ... Check if photos have helmets/goggles."* Helmets/goggles confound CLIP because they obscure the visual context CLIP keys on, but they don't faze a real face-recognition model (InsightFace, FaceNet, ArcFace).

### Hybrid signals introduced on the rewrite branch

The rewrite hedges against CLIP's accuracy with two extra modalities:

- **`lib/media/perceptual-hash.ts`** — 64-bit aHash (8x8 grayscale). Used to find near-exact duplicates via the `photos.photo_hash` column.
- **`lib/media/color-signature.ts`** — 12-bin LAB color histogram (4 bins × 3 channels). Used as a coarse rejection filter against false positives with wildly different palettes. Stored in `photos.color_signature`.
- **`lib/media/image-utils.ts`** — shared `toImageBuffer` helper using Sharp.

The combination is a thoughtful hedge but doesn't fix the underlying choice of CLIP for face matching.

---

## 2. Database state

### Tables (current deployed state on staging)

#### `ai_search_profiles` — talent's saved searches + selfie embedding

- **Source:** `supabase/migrations/20250219000000_create_ai_search_profiles.sql`
- **Columns:** `id, user_id, name, selfie_embedding vector(768), activity_type, country, region, date_from, date_to, created_at, updated_at`
- **Original migration declared `vector(512)`**; the deployed schema (`20260427162800_remote_schema.sql:344`) silently widens to `vector(768)` — that change was made when the rewrite branch was being developed.
- **Indexes:**
  - btree on `user_id`, `activity_type`, `country`, `created_at`
  - **HNSW** on `selfie_embedding` with `vector_cosine_ops`, `m=16, ef_construction=64`
- **RLS:** owner-scoped (4 policies for SELECT/INSERT/UPDATE/DELETE on `auth.uid() = user_id`). **Clean.**

#### `photo_embeddings` — per-photo CLIP embedding

- **Source:** `supabase/migrations/20250219000001_create_photo_embeddings.sql`, modified by `20260427162800_remote_schema.sql`
- **Columns:** `photo_id uuid PRIMARY KEY, embedding vector(768), model_version text, created_at, updated_at`
- The original `id uuid` PK was dropped (line 368 of remote schema dump); now the PK is `photo_id` itself, eliminating the `(photo_id, model_version) UNIQUE` need.
- **Indexes:**
  - btree on `photo_id`, `model_version`, `created_at`
  - **HNSW** on `embedding` with `vector_cosine_ops`, `m=16, ef_construction=64`
- **RLS:** SELECT allowed for (a) photographer who owns the photo, (b) talent tagged in the photo, (c) anyone for photos in public events. INSERT/UPDATE policies are `using (true) with check (true)` — **same defense-in-depth gap that was just closed on `orders` and `payouts`**. Authenticated users can write arbitrary embeddings via PostgREST.

#### `ai_search_usage` — monthly rate limit counter

- **Source:** `supabase/migrations/20250219000002_create_ai_search_usage.sql`
- **Columns:** `id, user_id, search_count, period_year, period_month, created_at, updated_at` — `UNIQUE(user_id, period_year, period_month)`
- **Functions:**
  - `increment_ai_search_usage(p_user_id uuid)` — `SECURITY DEFINER`, atomic `INSERT ... ON CONFLICT DO UPDATE`
  - `get_ai_search_usage_count(p_user_id uuid)` — `SECURITY DEFINER STABLE`
- **RLS:** SELECT scoped to owner; UPDATE/INSERT/DELETE is `for all using (true) with check (true)` — same defense-in-depth gap.
- **Function EXECUTE permissions: never revoked from anon/authenticated** (same bug class as the rate-limit RPC bug fixed earlier in this session).

#### Photo augmentations (added by rewrite, deployed via remote schema dump)

- `photos.photo_hash text` + `photos_photo_hash_idx` btree — for exact/near-duplicate matching
- `photos.color_signature double precision[]` — 12-bin LAB histogram

These columns exist in production but `main`'s TypeScript code never writes to or reads from them.

### RPC: `search_photos_by_similarity`

**Source:** `supabase/migrations/20260427162800_remote_schema.sql:478` (and a duplicate at line 513).

- **Two overloaded definitions** with the same name but different parameter types:
  - **The one that works** (line 478): `date` parameters, `SECURITY DEFINER`, joins `photo_embeddings → photos → events → profiles`. Filters by activity, country, region (events.state), date range. Returns photo + similarity + photographer info.
  - **The broken one** (line 513): `timestamptz` parameters, references nonexistent `events.activity_type`, `events.region`, and a `user_profiles` table. Will fail at runtime if called. Dead code — should be dropped.

The working RPC uses `1 - (pe.embedding <=> p_embedding)` — cosine distance via pgvector — and orders by the same expression so the **HNSW index can be used**. This is the correct pattern.

---

## 3. Query layer

### `database/queries/ai-search-profiles.ts`

**KEEP.** Standard CRUD on `ai_search_profiles` — clean, owner-scoped, formats the embedding for pgvector via `[${arr.join(',')}]`. Reusable as-is. The column type changed from 512 to 768 dims under it but the TS types use `number[]` which doesn't care about dimension.

### `database/queries/ai-search-usage.ts`

**KEEP.** Calls the SECURITY DEFINER RPCs (`increment_ai_search_usage`, `get_ai_search_usage_count`) with a manual fallback if the RPC errors. Defensive but reasonable. The RPC EXECUTE-grant security gap should be patched at the SQL layer, not in this file.

### `database/queries/ai-similarity-search.ts` ⚠️

**REFACTOR (the v1 in `main`) / KEEP (the rewrite version on `feature/ai-matching-rewrite`).**

The version on `main` is the most damning artifact in the audit:

- It has the right *intent* (find photos similar to a selfie embedding).
- It does **not** call the pgvector RPC. Instead it `SELECT * FROM photo_embeddings WHERE embedding IS NOT NULL LIMIT 1000` — pulling up to 1000 rows × 768 floats (~6 MB raw) into the Node process per search.
- Computes cosine similarity in JavaScript (`cosineSimilarity` at line 240).
- The HNSW index that the migrations carefully created is **never used.**
- `LIMIT 1000` silently caps the search — at >1000 photos in the table, results become arbitrary.
- The author left explicit TODO comments (lines 45-77) acknowledging this is a placeholder.

The version on `feature/ai-matching-rewrite` (633 lines) does the right thing:

- Calls `supabase.rpc('search_photos_by_similarity', {...})` and maps results.
- Falls back to legacy app-layer search if the RPC errors (graceful migration).
- Adds `findExactPhotoMatchesByHash(photoHash, filters)` — uses `photos.photo_hash` for exact-duplicate detection as a complementary path.
- Validates embedding dimension against `EXPECTED_DIMENSION = 768`.
- Threshold raised from `0.5` (mock-era default) to `0.92` (high-precision default for real CLIP scores).

---

## 4. Feature flag

**File:** `lib/feature-flags.ts`

```ts
export const FEATURE_FLAGS = {
  AI_MATCHING: false, // Disabled - Coming soon
} as const;
```

Hardcoded boolean. No env-var bypass. To enable, edit this file and redeploy.

**Read in three places** (verified via grep):

1. `lib/feature-flags.ts:17` — declaration
2. `app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-button.tsx:13` — disables button + shows "Coming soon" tooltip when off
3. `app/[lang]/dashboard/talent/photos/ai-matching/ai-matching-modal.tsx:48` — closes the modal and toasts "AI Matching is coming soon" if it's off (defensive — should not be reachable since the button is disabled)

**Server-side actions in `actions.ts` do NOT check the flag.** They're callable today by anyone who can construct a `runAISimilaritySearch` invocation (e.g., via the React Server Action endpoint). With the mock provider returning random vectors, similarity scores would be garbage but the rate-limit counter would still increment and a `talent_photo_tags` row could still be created via `addMatchedPhotosToLibrary`. Not a security issue per se — auth is enforced — but the flag check is incomplete.

---

## 5. Frontend touchpoints

### Components (under `app/[lang]/dashboard/talent/photos/ai-matching/`)

| File | LoC | Role | Status |
|---|---|---|---|
| `ai-matching-button.tsx` | 44 | Entry-point button. When flag off, renders disabled w/ "Coming soon" tooltip. | KEEP shape, REFACTOR copy when feature ships |
| `ai-matching-modal.tsx` | 606 | 5-step wizard: upload → filters → preset → searching → results | KEEP — UX is non-trivial work, REFACTOR underlying calls when search is rewritten |
| `ai-matching-results.tsx` | 218 | Results grid with confidence badges (Likely/Possible/Low based on score thresholds), multi-select, "Add to library" | KEEP |
| `actions.ts` | 417 | Server actions: profile CRUD, rate-limit check, search invocation | KEEP shape (auth/RLS/rate-limit pattern is good); the search path itself is REFACTOR (it calls the broken JS-side similarity) |

### Mount points

The button is mounted on three pages:

- `app/[lang]/dashboard/talent/events/explore-page-content.tsx:119` — talent's events explorer (only when the talent's profile has the right state per `showFindMe` logic)
- `app/[lang]/dashboard/talent/events/[id]/page.tsx:153` — talent's per-event view
- `app/[lang]/events/[shareCode]/page.tsx:476` — public event page (visible to non-authenticated visitors as well)

All three currently render the disabled "Coming soon" state because of the feature flag.

### Selfie upload validation in the modal

`ai-matching-modal.tsx:111-120` — validates `image/*` MIME and 10 MB max client-side. **Same class of bug as the file-upload finding from the recent security audit:** trusts client-supplied MIME, no server-side magic-byte check on the selfie. When the feature ships, the selfie path should reuse `lib/photo-upload.ts:validatePhotoUpload` introduced in the security work.

---

## 6. Why was it disabled?

**No explicit explanation in commits or comments** — the disablement is simply `AI_MATCHING: false` with the comment `// Disabled - Coming soon`.

### Timeline reconstruction (from `git log`)

| Date | Commit | What happened |
|---|---|---|
| 2025-11-25 | `3d97ea3 ai-matching v1` | Initial AI matching shipped: mock provider, app-layer JS similarity, dim=512 |
| 2025-11-28 (morning) | `d6fa174` (on `feature/ai-matching-rewrite`) | Replicate rewrite + hybrid hash/color + RPC call + backfill script + docs |
| 2025-11-28 (later same day) | `e583c58` (on `main`) | Adds feature flag, deletes `ai-search-profiles-section.tsx` (189 lines from talent profile), gates button/modal — **AI matching effectively disabled in main** |
| 2026-05-09 | (today) | Branch is 5+ months stale, never merged |

So v1 shipped Tuesday, the rewrite was started Friday morning, and Friday afternoon the feature was hidden behind a flag on main. The rewrite branch was the next-attempt working area but never made it back.

### Inferred reasons (in order of likelihood)

1. **Mock similarity scores were embarrassingly bad.** The `docs/AI_EMBEDDINGS_SETUP.md` on the rewrite branch literally opens with: *"⚠️ The application is currently using a MockEmbeddingProvider... Similarity scores are NOT accurate and should not be trusted for production use."* That alone justifies pulling the feature.

2. **CLIP is the wrong primitive for face recognition.** The rewrite chose `andreasjansson/clip-features`, which encodes general visual semantics — "person on bike with helmet" — not face identity. The rewrite's own troubleshooting section flags helmets/goggles as accuracy killers, which is exactly CLIP's failure mode. For sports photography (helmets, sunglasses, motion blur), CLIP is mediocre; a face-recognition-specific model (InsightFace via Replicate, or a self-hosted ArcFace) is much stronger.

3. **Replicate's async + cold-start latency on Vercel serverless.** Predictions take 1-60 seconds with polling; the request runs inside a server action's lifetime. Combined with Replicate's 6-req/min free-tier limit and the embedding-queue's 5-req/min internal pacing, throughput is poor. A real fix would need a queue or webhook-driven pipeline.

4. **Unsolved upload pipeline.** Photo embeddings need to be generated for *every* uploaded photo. Photographers upload bulk (50+ photos). The branch added `embedding-queue.ts` and a `scripts/update-photo-embeddings.ts` backfill, but on Vercel there's no obvious place for the per-upload generation to live (server actions time out; no native background workers).

5. **Cost.** $0.25/1k images sounds cheap until you have one wedding photographer uploading 2000 photos in a Saturday → $0.50 per shoot just for embeddings, with no revenue floor on free-tier photographers. Multiplied across the platform, this is a recurring cost that grows with volume regardless of search activity.

The combination is enough for a small team to defer rather than push through.

### What remained in main as residue

- DB schema is partly upgraded (768-dim, photo_hash, color_signature, working RPC) — a half-applied state where the columns exist but TS doesn't use them.
- TypeScript still ships the broken in-JS similarity loop and the mock provider.
- UI is fully built, gated by a one-line flag.
- A second, **broken** overload of `search_photos_by_similarity` exists in the schema and would fail at runtime if called.

---

## 7. Reusability assessment

### KEEP (works as-is, integrate directly)

| Artifact | Path | Why |
|---|---|---|
| `EmbeddingProvider` interface | `lib/ai/embedding-provider.ts` | Clean abstraction; rewrite branch and main agree on the shape |
| `ai_search_profiles` table + RLS + HNSW index | `supabase/migrations/20250219000000_*.sql` + remote schema dump | Owner-scoped, indexed, just needs the dim to match the chosen model |
| `database/queries/ai-search-profiles.ts` | as-is | CRUD is correct, dimension-agnostic |
| `database/queries/ai-search-usage.ts` | as-is | Calls RPCs with manual fallback |
| `ai_search_usage` table + atomic RPCs | `supabase/migrations/20250219000002_*.sql` | Monthly counter is right shape |
| `lib/ai/rate-limits.ts` | as-is | Tier-based monthly quotas (3/20/unlimited) |
| `AIMatchingButton`, `AIMatchingModal`, `AIMatchingResults` UI | `app/[lang]/dashboard/talent/photos/ai-matching/` | Multi-step wizard UX is significant work, copy is fine |
| `actions.ts` server action shape | same dir | Auth check + role check + rate-limit check + RPC call pattern is correct |
| `search_photos_by_similarity` (the date-typed overload, line 478 of remote schema) | deployed RPC | Uses HNSW correctly, joins right tables, takes the right filters |
| `photos.photo_hash` + index | deployed | Useful for exact/near-dup secondary signal |
| `photos.color_signature` | deployed | Useful as low-cost rejection filter |

### REFACTOR (good idea, needs rework)

| Artifact | What's wrong | What to do |
|---|---|---|
| `findSimilarPhotos` in `database/queries/ai-similarity-search.ts` (main version) | Loads up to 1000 rows, computes cosine in JS, `LIMIT 1000` silent truncation, ignores HNSW index | Replace with the RPC-calling version from the rewrite branch |
| `lib/ai/embedding-provider.ts` | Mock-only; default 512-dim conflicts with deployed 768-dim DB | Keep the interface; replace `getEmbeddingProvider()` with a factory; pick a face-recognition-focused model (not CLIP) |
| `photo_embeddings` INSERT/UPDATE RLS | `using (true) with check (true)` — any authenticated user can write any row | Drop the policies (writes only via service-role) — same fix as the recent orders/payouts work |
| `ai_search_usage` UPDATE/INSERT/DELETE RLS | Same `using (true)` pattern | Same fix |
| `increment_ai_search_usage`, `get_ai_search_usage_count` RPCs | `SECURITY DEFINER` without explicit `revoke execute from anon, authenticated` | Add the revoke (same gotcha as the rate-limit RPC fix earlier this session) |
| Selfie upload in `ai-matching-modal.tsx` | Trusts client-supplied MIME, no magic-byte check | Reuse `lib/photo-upload.ts:validatePhotoUpload` |
| Feature-flag check | UI-only; server actions don't gate on it | Add flag check in the server actions or guard the path at server layer |
| `embedding-provider.ts` dimension default (512) | Mismatch with deployed `vector(768)` schema — `storePhotoEmbedding` would fail today if it ever ran | Align the mock dim to whatever the chosen production model uses |

### DELETE

| Artifact | Why |
|---|---|
| `MockEmbeddingProvider` | Genuinely useful only for unit tests; in production it produces meaningless similarity. If kept, it should live behind a `NODE_ENV !== 'production'` guard in the factory |
| The broken second overload of `search_photos_by_similarity` (remote schema dump line 513-549) | References `events.activity_type`, `events.region`, `user_profiles` — none of which exist. Dead code; will fail if ever called |
| `lib/ai/embedding-provider.ts:cosineSimilarity` (only the in-JS similarity loop in `ai-similarity-search.ts:240-266`) | Only used by the broken in-JS search path. The DB does this with `<=>` |
| Hardcoded JS similarity threshold logic in `ai-matching-results.tsx` (`>= 0.8 = "Likely"`, etc.) | Calibrated for mock + cosine on raw float vectors. Real model will need re-calibration. Keep the UI shape, recompute thresholds against the real model's score distribution |

### NEEDS DECISION (not pure code questions)

- **Which embedding model.** CLIP is what the rewrite chose; the codebase's own docs admit it struggles with helmets/goggles. For sports photography this is a structural mismatch. Real face-recognition models (InsightFace ArcFace, FaceNet, Google Vertex AI) are stronger primitives.
- **Where embeddings are generated.** Per-upload (slows uploads, costs Replicate per-photo), background queue (needs a worker — Vercel doesn't natively provide one), or batched (latency between upload and searchability).
- **Whether to keep the per-photographer-upload cost model or pass it through.** $0.25/1k photos is real recurring cost.
- **Whether the hybrid (perceptual hash + color signature + embedding) is worth it.** Rewrite branch built it; never had a chance to validate accuracy gains.
- **Whether to merge or rebuild the rewrite branch.** It's 5 months stale and predates: rate-limit infrastructure, admin_users, the orders/payouts RLS hardening, the `validatePhotoUpload` helper, the security headers work. Rebasing is non-trivial. Cherry-picking the AI-specific files onto main is probably cleaner than a full rebase.

---

## 8. File-by-file inventory (quick reference)

### On `main`

```
lib/ai/embedding-provider.ts          162  Mock provider + interface — REFACTOR
lib/ai/rate-limits.ts                  72  Tier rate limits — KEEP
lib/feature-flags.ts                   26  AI_MATCHING flag — KEEP
database/queries/ai-search-profiles.ts 199 Profile CRUD — KEEP
database/queries/ai-search-usage.ts    109 Usage counter — KEEP
database/queries/ai-similarity-search.ts 295 Broken JS similarity — REFACTOR (replace with rewrite version)
app/[lang]/dashboard/talent/photos/ai-matching/
  actions.ts                           417 Server actions — KEEP shape, REFACTOR search call
  ai-matching-button.tsx                44 Entry button — KEEP
  ai-matching-modal.tsx                606 5-step wizard — KEEP
  ai-matching-results.tsx              218 Results grid — KEEP shape, recalibrate thresholds
```

### Only on `feature/ai-matching-rewrite` (not in `main`)

```
lib/ai/embedding-factory.ts           134  Provider selector — KEEP if model choice is reaffirmed
lib/ai/replicate-embedding-provider.ts 315  Replicate CLIP — KEEP if CLIP is still the choice; REPLACE if face-rec model chosen
lib/ai/embedding-queue.ts              63  Rate-paced queue — KEEP (any provider needs this)
lib/math/vector.ts                     23  Vector helpers — KEEP
lib/media/perceptual-hash.ts           62  aHash — KEEP if hybrid stays
lib/media/color-signature.ts           60  LAB histogram — KEEP if hybrid stays
lib/media/image-utils.ts               36  Sharp helpers — KEEP
scripts/update-photo-embeddings.ts    456  Backfill — KEEP shape, fix env loading
docs/AI_MATCHING.md                    60  User-facing doc — KEEP
docs/AI_EMBEDDINGS_SETUP.md            56  Operator doc — KEEP
SETUP_REAL_AI_EMBEDDINGS.md            67  Same content (consolidate with above)
SETUP_REPLICATE_EMBEDDINGS.md          64  Same content (consolidate)
```

### Database (deployed staging)

```
ai_search_profiles                  KEEP — owner-scoped RLS, HNSW indexed
photo_embeddings                    REFACTOR — fix permissive INSERT/UPDATE RLS
ai_search_usage                     REFACTOR — fix permissive RLS + RPC EXECUTE grants
photos.photo_hash                   KEEP — present, indexed, unused by code
photos.color_signature              KEEP — present, unused by code
search_photos_by_similarity (date)  KEEP — correct, uses HNSW, never called by current code
search_photos_by_similarity (tstz)  DELETE — references nonexistent columns
increment_ai_search_usage           KEEP — atomic, but harden EXECUTE grants
get_ai_search_usage_count           KEEP — same
```

---

## 9. Open questions for the next phase (architecture, not in this audit)

1. Is **face-identity recognition** (matching a specific person across photos) the actual product requirement, or is **visual similarity** ("photos that look like this scene") sufficient? CLIP fits the second but not the first.
2. What's the acceptable latency for "I uploaded a selfie, where are my photos"? <5s vs <60s changes the architecture (sync provider vs queue).
3. Where does embedding generation run? Inline in upload server action, queue worker, or batch job?
4. Does the platform absorb embedding costs or pass them through to the photographer's plan tier?
5. What's the accuracy floor we'll accept before launching? (Calibrate against a labeled photo+selfie test set rather than vibes.)

These are not code questions and are out of scope for this audit, but the next phase will need to answer them before building.
