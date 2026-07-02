# T-060 · Paginar la galería de fotos del detalle del evento (load more) en las 3 vistas

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/event-gallery-pagination`
- **OpenSpec change:** — (perf/UX; implementar directo, validar el enfoque de paginación)
- **PR:** —

## Requerimiento
En la página de **detalle del evento**, hoy se cargan, firman y renderizan **todas** las fotos de golpe (un
evento con 264 fotos devuelve y pinta las 264). Es una carga de recursos innecesaria, sobre todo porque el
usuario suele usar **búsqueda facial** y no recorre las fotos una a una. Se quiere paginar: renderizar un número
finito (≈ **50**) y un botón **"Cargar más" / Load more** para traer las siguientes.

Aplica a las **3 vistas** del detalle del evento:
- Dashboard del **fotógrafo** (`/dashboard/photographer/events/[id]`).
- Dashboard del **talento** (`/dashboard/talent/events/[id]`).
- Vista **pública** del evento sin autenticar (`/events/[shareCode]`).

## Contexto / diagnóstico (confirmado en código)
- Pública y talento usan `getEventPhotosPublic(eventId)` (`src/database/queries/photos.ts:255`) → trae **todas**
  las fotos `approved` sin límite; la página **firma todas** las URLs (`createPhotoUrls`).
- Fotógrafo usa `getEventPhotos(...)` (`dashboard/photographer/events/[id]/page.tsx`) → también sin límite.
- Coste: N filas + N signed URLs + N tiles por carga. Con 264 fotos es notablemente pesado.

## Criterio de aceptación (Definition of Done)
- [ ] Las 3 vistas renderizan inicialmente un tope finito (**default ~50**, constante configurable) y ofrecen
      **"Cargar más"** para traer el siguiente lote, apilándolo en la grilla (masonry) sin recargar la página.
- [ ] Solo se **firman** las URLs del lote realmente cargado (no las 264) — el ahorro de recursos es el objetivo.
- [ ] La query de fotos acepta paginación (límite + cursor por `taken_at`/`id`, preferible a offset por orden
      estable) y expone si **hay más** (`hasMore`/nextCursor).
- [ ] El **conteo total** del evento se sigue mostrando correcto aunque solo se rendericen 50 (coordinar con
      T-057; no derivar el total del número renderizado).
- [ ] **Búsqueda facial** sigue funcionando: al buscar, la grilla muestra el subconjunto emparejado (ya acotado);
      "Cargar más" aplica a la galería completa, no rompe el modo búsqueda. Definir la interacción.
- [ ] Coherencia con el **cache** de la página pública (`getCachedEventData` usa `'use cache'` y firma todo
      dentro del cache): los lotes siguientes se traen/firman vía Server Action (o rutas por `searchParams`),
      manteniendo el anti-flash de URLs firmadas. Definir el enfoque.
- [ ] strings nuevos ("Cargar más" / "Load more", "No hay más fotos") en `en.json` y `es.json`.
- [ ] test que falla antes y pasa después (paginación de la query: primer lote de N + `hasMore`; segundo lote
      continúa desde el cursor sin solapar ni saltar).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos probables: `src/database/queries/photos.ts` (`getEventPhotosPublic`, `getEventPhotos` → añadir
  límite/cursor), las 3 `page.tsx` del detalle, `src/components/photo-album-viewer.tsx` (append de lotes +
  botón), y la Server Action que sirva los lotes con sus signed URLs. Vista pública: `events/[shareCode]/page.tsx`
  + `event-gallery-with-face-search.tsx`.
- `width`/`height` ya se persisten por foto → el masonry puede crecer incrementalmente sin salto de layout.
- Relacionado con T-057 (conteo total) — al paginar, el total NO debe salir del número renderizado.
- Decidir tamaño de página (propuesta: 50) y estrategia (cursor recomendado). El watermarking/servido de
  previews no cambia; solo se firma/pide menos por carga.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
