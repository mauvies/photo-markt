# T-104 · Contador de fotos en la toolbar de la galería (izquierda, junto al botón "Select")

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/photo-count-in-gallery-toolbar`  (tipo = feat)
- **OpenSpec change:** —  (UI: componentes compartidos + 3 vistas + 3 páginas; se implementó directo)
- **PR:** #169

## Requerimiento
Mostrar el conteo de fotos en la fila de la toolbar de la galería (la fila que tiene el botón "Select" a
la derecha), en el **extremo izquierdo** (donde hoy van las tabs o queda vacío). El botón "Select" sigue a
la derecha, sin cambios.

**Eventos CON tabs** (colaborativos, "All photos" / "My photos"): integrar el conteo en cada label:
- "All photos (116)" / "Todas las fotos (116)" — total de fotos del evento.
- "My photos (12)" / "Mis fotos (12)" — total de fotos subidas por el usuario actual.
- Los conteos se actualizan reactivamente al cambiar los sets subyacentes (tras subir, borrar, o al
  cambiar identificación autenticado/invitado para "mis fotos").

**Eventos SIN tabs** (galerías simples, sin distinción "mine"): mostrar un label standalone
"Photos (116)" / "Fotos (116)" en la misma posición izquierda donde irían las tabs, con el total del
evento.

**Ambos casos:** el conteo refleja el **total** del evento (respetando la paginación "Load more" — si se
muestran 24 de 116, el label muestra 116), **no** solo el lote cargado.

## Estado actual (verificado en el código)
- La toolbar compartida es `src/components/photo-selection-toolbar.tsx`: tiene un slot **`leading`**
  (extremo izquierdo, se renderiza cuando NO se está seleccionando; línea ~104) y el botón "Select" a la
  derecha. **Al entrar en modo selección el `leading` (tabs) se oculta** — el contador vivirá en ese mismo
  slot, así que naturalmente desaparece mientras se selecciona (consistente con el requerimiento: "Select"
  intacto a la derecha).
- Las tabs son `src/components/event-photo-filter-tabs.tsx` (`EventPhotoFilterTabs`, labels planos
  `allLabel`/`mineLabel`) — se le pasan hoy vía `toolbarLeading`. Hay que extenderlo para recibir/mostrar
  los conteos por tab.
- Wrapper: `src/components/photo-gallery/photo-gallery.tsx` (recibe `toolbarLeading`, lo pasa a la toolbar).
- **⚠️ Premisa falsa del requerimiento a corregir:** NO existe hoy un contador "Showing X of Y" en la
  galería. El hook `src/hooks/use-load-more-photos.ts` solo expone `hasMore` (no un total). Por lo tanto
  **no hay "lógica del contador de paginación" que reusar** — pero SÍ existe el **total real ya calculado
  server-side en cada página**, que hoy no se enhebra al viewer/toolbar. Reusar ESO (no recalcular):
  - **Pública** (`events/[shareCode]/page.tsx`): `totalCount` (el conteo real de aprobadas; líneas
    ~80/137/178) — hoy solo se usa para el JSON-LD (`numberOfItems`), **no** se pasa al
    `PublicEventPhotoViewer` (solo `initialHasMore`).
  - **Fotógrafo** (`dashboard/photographer/events/[id]/page.tsx`): `visibleCount` = "the TRUE non-rejected
    total" (líneas ~118/180) — hoy se usa para `RejectedToast`, **no** para la toolbar de la galería
    (`event-photo-album.tsx`).
  - **Talento** (`dashboard/talent/events/[id]/page.tsx`): pasa `uploadedPhotoIds` (set completo de las
    subidas del usuario) pero **no** un total del evento explícito → hay que enhebrar el total (reusar
    `getPhotoCountsForEvents` / el mismo conteo que la pública, no duplicar).
- **Conteo "My photos (N)":** en el viewer de talento el set del usuario viene del server
  (`uploadedPhotoIds`, completo) → usar su `.size`. En el viewer público (`public-event-photo-viewer.tsx`)
  `myPhotoIds` se **deriva client-side** sobre `displayablePhotos` (solo cargadas + matched) + guest-owned,
  así que puede **subcontar** frente al total real si hay paginación. Decisión sugerida (a validar al
  ejecutar): "All photos (N)" = total server; "My photos (N)" = tamaño del set "mine" reactivo
  (client-derived) tal como pide el requerimiento ("update reactively … al cambiar identificación
  autenticado/invitado"). Documentar la limitación si "mine" no puede ser un total absoluto en público.

## Alcance
Aplicar a las 3 vistas de galería de evento que usan esta toolbar:
- `src/components/event-photo-filter-tabs.tsx` — aceptar conteos y renderizar `label (N)` por tab.
- `src/components/photo-selection-toolbar.tsx` / `photo-gallery/photo-gallery.tsx` — soportar el label
  standalone "Photos (N)" en el slot `leading` cuando no hay tabs (sin romper el ocultado en selección).
- `events/[shareCode]/public-event-photo-viewer.tsx` (+ `page.tsx`) — enhebrar `totalCount` al viewer.
- `dashboard/talent/events/[id]/event-photo-viewer.tsx` (+ `page.tsx`) — total del evento + `.size` de
  "mine".
- `dashboard/photographer/events/[id]/event-photo-album.tsx` (+ `page.tsx`) — enhebrar `visibleCount`
  (sin tabs → label standalone "Photos (N)").
- `src/dictionaries/en.json` + `es.json` — nuevos strings: label standalone `Photos (N)`/`Fotos (N)` y,
  para las tabs, o bien un template `{label} ({n})` o labels que compongan el número (reusar
  `EventPhotoFilterTabs` labels existentes; no hardcodear).

## Criterio de aceptación (Definition of Done)
- [ ] En eventos con tabs, cada label incluye su conteo: "All photos (N)" y "My photos (N)".
- [ ] En eventos sin tabs, aparece un label standalone "Photos (N)" en la misma posición izquierda.
- [ ] El botón "Select" queda a la derecha, sin cambios.
- [ ] Los conteos reflejan el **total** del evento (no solo el lote cargado), reusando el total real ya
      calculado server-side (`totalCount` público / `visibleCount` fotógrafo / conteo equivalente talento)
      — no se recalcula un total separado.
- [ ] Los conteos se actualizan tras subir, borrar o cambiar de contexto (identidad autenticado/invitado
      para "mine").
- [ ] Aplica consistente en las 3 vistas de galería de evento.
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (p.ej.: la toolbar renderiza "All photos
      (N)"/"My photos (N)" con los conteos correctos en colaborativo, y "Photos (N)" standalone sin tabs;
      el total viene del prop server, no del nº de items cargados).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **No** recomputar el total: reusar el valor server-side ya existente por página (arriba). El requerimiento
  menciona un contador "Showing X of Y" que **no existe**; el sustituto correcto es enhebrar ese total.
- Componentes Shadcn existentes / markup existente de las tabs — sin nuevas libs de UI. Sin `any`. Biome.
- **Sin otros cambios.**
- Solape a coordinar: toca los mismos viewers/toolbar compartidos que **T-102** ("Añadir a favoritos" en
  el modal a dos paneles) — si ambos siguen vivos, mergear uno antes de empezar el otro para evitar
  conflictos en `photo-album-viewer.tsx`/los viewers. (Ojo: T-102 podría haberse perdido del backlog —
  ver resumen.)
- Durante una búsqueda facial (el viewer cambia a `FaceSearchResults`) las tabs no se muestran; definir si
  el contador aparece o no en ese modo (default sugerido: los conteos son totales del evento, no del
  subconjunto de búsqueda).
