# T-110 · Bug: la grilla/lightbox del dueño muestra el thumbnail con marca de agua, no el original

- **Prioridad:** P0
- **Estado:** done (PR #159)
- **Blockers:** ninguno (accionable de inmediato)
- **Rama:** **no crear rama nueva desde `main`** — el bug solo existe en la rama ya abierta `fix/owner-event-grid-uses-thumbnails` (PR #158, **sin mergear**). El fix va como commit adicional en esa misma rama, antes de mergear. `main` todavía no tiene este bug.
- **OpenSpec change:** — (fix acotado a 2-3 archivos ya identificados, no amerita)
- **PR:** seguir en PR #158 (https://github.com/mauvies2/photo-markt/pull/158)

## Requerimiento

Reportado por el usuario en `/es/dashboard/photographer/events/9cf72cd0-5580-4665-9d10-2e441bfe751d`: el fotógrafo ve sus propias fotos **con marca de agua** en la vista de gestión de su evento. Debería ver sus fotos originales, sin marca de agua, y en mejor resolución que los previews que ve el talento.

## Causa raíz (ya investigada — confirmada con `git log`, no solo hipótesis)

**Es un bug real, regresión introducida hoy (2026-07-10) por el commit `8287b0c`** ("fix(gallery): render thumbnails (not full-res originals) in the owner event grid"), que vive en la rama `fix/owner-event-grid-uses-thumbnails` / PR #158 — **`main` aún no tiene este código**, así que en producción hoy no está roto; se rompería si el PR #158 se mergea tal cual.

Ese commit resolvió un timeout real del optimizador de imágenes de Next.js con originales grandes, haciendo que la grilla del dueño empiece a usar `/api/thumb` (igual que la vista pública/talento) — pero `/api/thumb` **hornea con marca de agua cuando `event.watermark_enabled` es true** (`generatePhotoThumbnails`, `src/lib/inngest/functions/generate-photo-thumbnails.ts:184-206` — la fuente que se re-escala a 400px/800px WebP ya viene con `addWatermarkToImage` aplicado si el evento tiene watermark). El thumbnail es un artefacto **content-addressed y agnóstico de rol** — no existe variante "sin marca para el dueño".

**Dónde exactamente se elige la fuente incorrecta:**
- `buildOwnerPhotoAlbumItem` (`src/app/[lang]/dashboard/photographer/events/[id]/owner-album-item.ts:60-67`) ahora setea `thumbMedium`/`thumbSmall` (vía `thumbRelativeUrl(...)`) en cada item, además del `url` correcto (signed original sin marca, línea 51 — ese sí sigue bien).
- Dos componentes compartidos y agnósticos de rol prefieren `thumbMedium` sobre `url` siempre que esté seteado:
  - Grilla: `src/components/photo-album-viewer.tsx:247-255` → `src: p.thumbMedium ?? p.url`.
  - Lightbox/carousel: `src/components/photo-carousel.tsx:152` → `const src = item.thumbMedium ?? item.url` (con comentario explícito: "the original (`url`) is only fetched on explicit Download").
- Como ninguno de los dos sabe distinguir dueño de talento, y `buildOwnerPhotoAlbumItem` ahora siempre setea `thumbMedium`, el dueño ve el thumbnail (marca de agua + tope de 800px) tanto en la **grilla** como en el **lightbox de clic** — solo el botón explícito "Download" (`getPhotoDownloadUrlAction`, `events/[id]/actions.ts:306-327`) re-firma y devuelve el original real sin marca.
- La pestaña "Pending" (fotos aún no aprobadas) **no está afectada** — `pending-photos-tab.tsx` renderiza `photo.url` directo, sin pasar por `PhotoAlbumViewer`/`thumbMedium`.

`/api/watermark/[...path]` (la ruta de fallback pre-bake) **no** es la causa — el builder del dueño nunca la referencia; `createPhotoUrlMap` se llama sin `useWatermark` (`page.tsx:150-151`), así que el `signed`/`url` en sí siempre fue correcto. El bug es puramente de **selección de fuente** en los componentes de render compartidos.

## Direcciones de fix a evaluar (no implementadas aún — decidir al ejecutar)

a. En `buildOwnerPhotoAlbumItem`, no setear `thumbMedium`/`thumbSmall` cuando `event.watermark_enabled` es true — caer a `url` (el original firmado), y resolver el timeout del optimizador que motivó el commit original vía `unoptimized`/`shouldSkipImageOptimization` (ya existe en `src/lib/image-source.ts`, ver T-093) aplicado al signed original en vez de enrutar por el thumb con marca.
b. Hornear una segunda variante de thumbnail sin marca, solo para el dueño (más costo/complejidad — evaluar si vale la pena vs. opción a).
c. Pasar `role`/`isOwner` a través de `PhotoAlbumViewer`/`PhotoCarousel` para que prefieran `url` sobre `thumbMedium` en contexto de dueño.

La opción (a) es la más simple y coherente con por qué existe `/api/thumb` (ahorro de egress/perf para vistas públicas de solo-preview) — el dueño no necesita ese ahorro, necesita ver su material real.

## Criterio de aceptación (Definition of Done)

- [ ] En la grilla del dueño (`/dashboard/photographer/events/[id]`), para eventos con `watermark_enabled=true`, las fotos se muestran **sin marca de agua**.
- [ ] En el lightbox/click-through del dueño, la imagen mostrada es el original (o una fuente de mejor resolución que el thumbnail de 800px) sin marca de agua — no depende de hacer clic en "Download" para ver la foto limpia.
- [ ] La vista pública/talento (`events/[shareCode]`, `dashboard/talent/events/[id]`) sigue mostrando el thumbnail con marca de agua sin cambios — **no regresionar** ese comportamiento.
- [ ] El timeout del optimizador de imágenes que motivó el commit `8287b0c` sigue resuelto (no reintroducir el problema original de performance con originales grandes en la grilla del dueño).
- [ ] Test de regresión: item del dueño en evento con watermark → fuente de imagen no apunta a un thumbnail generado con marca de agua (falla antes del fix / pasa después).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

- **No es un bug de producción activo** — vive únicamente en PR #158 abierto, sin mergear. Prioridad P0 porque bloquea mergear ese PR con una regresión funcional real (el fotógrafo pierde acceso a sus fotos reales/sin marca en su propio dashboard), no porque haya usuarios afectados hoy en `main`.
- Contexto completo de investigación (líneas exactas, verificado con `git log` sobre `owner-album-item.ts`) ya recopilado — no debería hacer falta re-investigar desde cero al ejecutar este ticket.
