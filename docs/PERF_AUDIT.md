# Frontend Performance Audit (T-123)

Lighthouse / Core Web Vitals audit of the browser-rendering side of Photo Markt, plus the
high-impact/low-risk fixes applied in the same PR. Follow-up model mirrors the caching audit
(`CACHING_AUDIT.md`, T-083): what didn't fit here is captured as backlog tickets.

**Scope boundary:** backend/caching/egress was already covered by T-083 and its follow-ups
(T-084–T-101). This audit is the frontend/render axis only: LCP, CLS, INP/TBT, JS bundle, fonts,
render-blocking work, above-the-fold images. Previously fixed perf items were not re-opened:
cart-icon CLS (T-114), `unoptimized` on thumbs/originals (T-093/T-110/T-111), `router.refresh()`
removal from the add-to-cart hot path (T-101).

## Methodology

- Lighthouse 12.8.2, **mobile emulation + default throttling**, performance category only.
- Production build (`next build` + `next start`) on localhost, against the production Supabase
  project (real events/photos). Local serving means **no CDN/network latency in the numbers** —
  absolute values are optimistic vs. the real deployment; deltas are what matters.
- 3 runs per route, medians reported.
- Routes: `/es` (home), `/es/events` (listing), `/es/events/maraton-madrid-2026-madrid-spain-2026`
  (photo-rich gallery, 155 photos).
- The talent dashboard needs an authenticated session, which headless Lighthouse doesn't have.
  Since T-118 the home page and the talent Explore page render the **same** `EventsExploreView`
  (only the header differs), so the home findings carry over; an authenticated Lighthouse pass
  stays as a nice-to-have.

## Before → after (medians of 3 runs)

| Route | Score | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| `/` (home) | 75 → **77** | 1206 → 1206ms | 7540 → **6577ms** | 95 → **46ms** | 0.044 → 0.044 | 1206 → 1206ms |
| `/events` | 76 → **77** | 1058 → 1057ms | 7151 → **6408ms** | 81 → 84ms | 0.000 → 0.000 | 1058 → 1057ms |
| `/events/[shareCode]` (gallery) | 76 → **76** | 1338 → 1331ms | 7963 → **7267ms** | 57 → **51ms** | 0.000 → 0.000 | 2417 → **1331ms** |

Also: unused-JS estimate 218 → 182 KiB on home/events; ~7 fewer requests and ~100 KB less
transfer on home/events (fonts + framer-motion out of the first load).

**LCP is the dominant problem on every route** (the LCP element is always an event-cover /
photo-tile `<img>`). CLS and TBT were already healthy. The fixes below took ~0.7–1.0s off LCP;
the remaining ~6.5s is structural (see follow-ups F1/F2 — the biggest lever is that the home/events
grid is fetched client-side after hydration, so no image fix can start before that chain finishes).

## Fixes applied in this PR

1. **Fonts: 4 Google families → 2** (`src/app/layout.tsx`, `globals.css`).
   `Syne` (2 weights) was loaded on every page but mapped to a `--font-wordmark` token **nothing
   uses**; `Geist Mono` styled only the share-code display, an order id, and chart tooltips — now
   served by Tailwind's system mono stack. Each family was a render-critical font download
   competing with the JS/LCP fetches. `Inter` (body) and `Inter Tight` (headings) remain.
2. **LCP images no longer wait for JS to paint** (`event-card.tsx`, `photo-album-viewer.tsx`).
   Cover/tile images rendered `opacity-0` until React hydrated **and** `onLoad` fired, then faded
   in — so an SSR'd, preloaded priority image couldn't paint before hydration, and every LCP
   paid hydration + decode + 200–300ms fade. Now `priority` (above-the-fold) images are visible
   immediately with the skeleton rendered *behind* them (progressive paint covers it); Lighthouse
   confirms the LCP element no longer carries the opacity gate. Below-the-fold images keep the
   fade-in polish. Regression tests in `test/unit/components/{event-card,photo-album-viewer}.test.tsx`.
3. **framer-motion out of the hot-route bundle** (`EventSearchBar.tsx`). The search bar — mounted
   on home, `/events`, and talent Explore — imported the whole library for one entrance fade on the
   mobile search dialog (whose exit animation never even ran: Radix unmounts on close). Replaced
   with the same tw-animate-css classes the dialogs already use. The only remaining consumer is
   `feedback-view.tsx` (dashboard-only route), so framer-motion no longer ships on any public route.
4. **`preconnect` to the Supabase Storage origin** (root layout). Event covers and purchased
   photos are signed URLs on a different origin in production; the hoisted `<link rel="preconnect">`
   warms DNS+TLS while the HTML parses. (Invisible in the localhost numbers — it targets the real
   deployment.) Note: a literal `<link>` tag, because `react-dom`'s `preconnect()` from a Server
   Component only reaches the flight payload (client-side, post-JS — too late).
5. **Dead code:** deleted `src/components/location-selector.tsx` (no importers) and its
   `country-state-city` dependency (multi-MB package).

Checked and already fine: `optimizePackageImports` (Next's default list covers lucide-react /
date-fns; recharts is dashboard-only), `react-day-picker` (already code-split behind the search
dialog), image `sizes`/`priority` on grids (already present), Vercel Analytics/SpeedInsights
(prod-only, non-blocking), security headers, viewport.

## Prioritized findings deferred to follow-up tickets

- **F1 — Home/events grid is fetched client-side after hydration (LCP driver #1).**
  `EventsExploreView` mounts `ExplorePageContent` with `loadOnMount` and no `initialEvents`, so on
  throttled mobile the LCP chain is HTML → JS → hydrate → search action POST → render → image.
  `/events` already server-prefetches when `where`/`status` is in the URL — the same pattern can
  seed the default view (needs a decision on the geolocation-based "nearby first" ordering, which
  is why it's client-side today). Highest-leverage change available (~6.5s LCP → the images could
  start with the HTML).
- **F2 — Gallery transfers ~12 MB of images (2.7 MiB estimated responsive-image savings).**
  Two compounding causes on the measured event: (a) ~50 of the first ~85 tiles had **no baked
  thumbnail** and fell back to the full-size `/api/watermark` preview (~150–190 KB each, 7.6 MB
  total) — a data/pipeline issue (legacy photos predating the thumbnail job; T-099's sweeper only
  re-drives `pending`, not `failed`/missing); (b) baked "medium" thumbs average ~110 KB for
  ~180px grid tiles — no smaller variant exists (`unoptimized` is deliberate per T-093, so no
  optimizer resize either). Candidate fixes: backfill/re-bake missing thumbnails; bake a "small"
  grid variant; cap eagerly-loaded tiles (native lazy-loading's mobile threshold pulls ~85 of 155).
- **F3 — ~182 KiB unused JS on first load of public routes.** Next targets: code-split the
  purchase/lightbox modal stack out of the gallery's initial bundle (`photo-detail-modal`,
  `photo-lightbox`, face-search UI — only needed on interaction), and audit the Sentry client
  bundle (`legacy-javascript` flags 13 KiB of polyfills there too).

## Re-measure notes

- Re-run after F1 lands — it should also let the EventCard `priority` prop do its job (preload
  only works for SSR'd images).
- T-118/T-119 already landed before this audit, so the landing/card findings are current.
- Command used per route:
  `npx lighthouse@12 <url> --only-categories=performance --output=json --chrome-flags="--headless=new"`
