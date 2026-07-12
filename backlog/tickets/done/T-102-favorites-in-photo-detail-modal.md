# T-102 · "Añadir a favoritos" en el modal de detalle de foto a dos paneles (panel derecho, junto al CTA)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/favorites-in-photo-detail-modal`  (tipo = feat)
- **OpenSpec change:** —  (UI reusando acción existente; se implementó directo sin OpenSpec)
- **PR:** #167

## Requerimiento
El modal de detalle de foto a dos paneles (imagen a la izquierda, panel de compra + CTA a la derecha —
`PhotoDetailModal`, de T-066) **no ofrece "Añadir a favoritos"** para fotos de pago con watermark.
Agregarlo al **panel derecho, cerca del botón "Add to Cart"** — **no** entre los iconos utilitarios de
arriba-derecha sobre la imagen (share + contador `X / Y`), que son acciones de utilidad, no de decisión
de compra.

**Racional (contexto, no re-litigar en implementación):** favoritos es una acción adyacente a la
decisión de compra ("lo quiero para después"), de la misma familia que "Add to Cart" ("lo quiero
ahora"), así que va con la decisión de compra en el panel derecho, no agrupada con los iconos
utilitarios sobre la imagen.

**Tratamiento visual:**
- Botón **secundario** (outline/ghost) — **no** debe competir con "Add to Cart" (el CTA primario sigue
  dominante). Colocado **arriba/junto** al botón de carrito en el bloque de precio+CTA fijado abajo.
- Corazón + label corto ("Add to favorites" / "Añadir a favoritos"), o icon-only con tooltip si un
  tratamiento más minimal encaja mejor cerca del precio — a discreción del implementador mientras no
  pese más que el CTA primario.
- Estado toggle: corazón **relleno** cuando ya está en favoritos, corazón vacío si no — reusando el
  patrón/estado de favoritos que ya existe (`showAddToPhotos`/`photosInMyPhotos` + heart icon).

**Lógica condicional:**
- **Solo para usuarios autenticados** (favoritos requiere cuenta). En el dashboard de talento el viewer
  siempre es autenticado; en la vista pública, gatear por `isAuthenticated` (los invitados no lo ven).
- Aplica a las fotos de pago con watermark (donde se monta este modal a dos paneles — variante
  `detailVariant='purchase'`). Los eventos **gratis** usan el `PhotoLightbox` (no este modal) y **ya**
  tienen favoritos ahí, así que quedan fuera de este ticket.

## Estado actual (verificado en el código)
- `PhotoDetailModal` (`src/components/photo-detail-modal.tsx`) **no declara** props de favoritos — su
  matriz de acciones es solo cart/download/share. La imagen muestra share + contador arriba-derecha; el
  panel derecho (`<aside>`) fija precio + `renderCta()` abajo.
- `photo-album-viewer.tsx` **ya recibe** los props de favoritos (`showAddToPhotos`, `photosInMyPhotos`,
  `onAddToPhotos`, `onRemoveFromPhotos`) y los enruta al **`PhotoLightbox`** (rama free/fotógrafo, líneas
  ~495-508), **pero NO a la rama `<PhotoDetailModal>`** (líneas ~466-485) — ese es exactamente el hueco.
- **Talent viewer** (`dashboard/talent/events/[id]/event-photo-viewer.tsx`): favoritos **ya totalmente
  cableado** — estado optimista `myPhotos`, `handleAddToPhotos`/`handleRemoveFromPhotos`, acciones
  `addPhotoToMyPhotosAction`/`removePhotoFromMyPhotosAction` (en `./actions.ts`; DB layer
  `src/database/queries/talent-photo-tags.ts`, tabla `talent_photo_tags`), y ya pasa
  `showAddToPhotos: true` + handlers en `galleryProps`. Solo falta que el modal los consuma.
  **Ojo:** `queries/talent-library.ts` es OTRA cosa (fotos reclamadas/compradas → "Add to profile"), no
  favoritos — no confundir.
- **Public viewer** (`events/[shareCode]/public-event-photo-viewer.tsx`): **NO** tiene favoritos
  cableado (su `galleryProps` no setea `showAddToPhotos` ni handlers de favoritos). Tiene
  `isAuthenticated`/`currentUserId` pero ningún estado `myPhotos`. → **Plumbing net-new**: reusar las
  acciones de favoritos existentes (auth-only), estado optimista `myPhotos` sembrado desde un prop server
  nuevo (ids ya favoriteados por el usuario), gateado por `isAuthenticated`; la página pública debe
  fetchear esos ids para el viewer autenticado (reusar la query de `talent-photo-tags`, no duplicar).

## Alcance
- `src/components/photo-detail-modal.tsx` — nuevos props de favoritos + labels + botón secundario en el
  panel derecho cerca del CTA (estado toggle relleno/vacío).
- `src/components/photo-album-viewer.tsx` — enrutar los props de favoritos ya disponibles a la rama
  `<PhotoDetailModal>` (hoy solo llegan al `PhotoLightbox`).
- `dashboard/talent/events/[id]/event-photo-viewer.tsx` — reusar el estado/handlers de favoritos ya
  existentes (probablemente solo pasar labels nuevos; el resto ya está en `galleryProps`).
- `events/[shareCode]/public-event-photo-viewer.tsx` (+ su `page.tsx`) — cablear favoritos reusando las
  acciones existentes, gateado por `isAuthenticated`; sembrar el set inicial de favoritos desde el server.
- `src/dictionaries/en.json` + `es.json` — strings "Add to favorites"/"Añadir a favoritos" (reusar keys
  de favoritos existentes si aplican, p.ej. las de `menuLabels.addToFavorites`/`removeFromFavorites`).

## Criterio de aceptación (Definition of Done)
- [ ] "Add to favorites" aparece en el **panel derecho** del modal, cerca de "Add to Cart" — **no** entre
      los iconos de arriba-derecha de la imagen.
- [ ] Visualmente **secundario** al CTA "Add to Cart" (el primario sigue dominante).
- [ ] Se muestra **solo para usuarios autenticados** (talent dashboard siempre; público solo si
      `isAuthenticated`).
- [ ] Estado toggle (corazón relleno/vacío) refleja si la foto ya está en favoritos, usando la lógica de
      favoritos existente.
- [ ] Click agrega/quita de favoritos vía la **Server Action existente** — **sin duplicar** lógica.
- [ ] Funciona consistente en `/dashboard/talent/events/[id]` **y** `/events/[shareCode]`.
- [ ] **NO** se modifican los iconos de arriba-derecha de la imagen (share, contador).
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (p.ej.: el modal renderiza el botón de
      favoritos en el panel para un usuario autenticado y lo oculta para invitado; el click invoca el
      handler existente; estado relleno cuando ya favoriteada).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Reusar** la Server Action de favoritos (`addPhotoToMyPhotosAction`/`removePhotoFromMyPhotosAction`,
  hoy en `dashboard/talent/events/[id]/actions.ts`) y el patrón de estado optimista (`myPhotos`) — no
  crear una implementación paralela. Verificar que la acción está auth-guardada y es reusable desde la
  superficie pública (misma cuenta/talent-library).
- Usar componentes Shadcn existentes (`Button` variant `outline`/`ghost`, `Tooltip` si icon-only) — sin
  nuevas libs de UI. Sin `any`. Formato Biome.
- El botón vive **debajo/junto** al bloque precio+CTA del `<aside>` (no en el header de la imagen).
- **Sin otros cambios.**
- No hay solape con tickets abiertos (T-089–T-101 son caching/Inngest). Relacionado con la familia del
  modal a dos paneles: T-066 (creación), T-077 (a11y focus), T-082 (iconos save/share del título) — todos
  ya done.
