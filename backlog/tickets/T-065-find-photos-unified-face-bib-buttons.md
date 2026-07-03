# T-065 · Unificar "Encontrar mis fotos": botones de face matching y dorsal lado a lado (responsive)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (Dep de T-064 para que el dorsal ya aparezca en ambas vistas)
- **Rama:** `feat/find-photos-dual-search-buttons`
- **OpenSpec change:** —  (UI; implementar directo)
- **PR:** —

## Requerimiento
Cuando un evento tenga **reconocimiento por dorsal** y **face matching** activados, la sección "Encontrar mis
fotos" debe mostrar **una sola sección** con: el **texto/título a la izquierda** y **a la derecha los dos
botones** uno al lado del otro (para ahorrar espacio vertical en la página):
- Botón 1: **Face matching** (EN) / su traducción al español.
- Botón 2: **Bib number matching** / "Dorsal matching" (EN) / "Reconocimiento por dorsal" o similar (ES).
En **mobile** la sección debe ser **responsive** (buscar la mejor distribución: botones apilados o en fila
compacta, sin romper el layout).

## Contexto / estado actual (código)
- Hoy son **dos tarjetas separadas** apiladas verticalmente:
  1. `components/ai-find-photos-banner.tsx` — tarjeta con texto a la izquierda y **un** botón (face search) a la
     derecha; el botón abre `FaceSearchModal`. Ya stackea en mobile (`flex-col sm:flex-row`).
  2. `components/bib-search-bar.tsx` — tarjeta **aparte** con título + input numérico inline + botón "Buscar"
     (búsqueda por dorsal in-place, filtra la grilla).
- Se componen en `components/event-gallery-with-face-search.tsx:125-141`: primero el banner
  (`aiSearchEligible && matches === null`), luego el bib bar (`bibDetectionEnabled && bibSearchLabels && matches === null`).
- La idea es **fusionar** ambas en una sola sección "Encontrar mis fotos" con dos botones a la derecha. Decidir
  cómo dispara cada botón su UI (el de cara ya abre modal; el de dorsal hoy es input inline → probablemente pasar
  a **modal/popover** para que ambos sean botones simétricos, o abrir un input inline al pulsar). Mantener el
  comportamiento de búsqueda existente (face → `FaceSearchModal`; dorsal → `searchPhotosByBibInEvent` + filtrado de
  grilla vía `BibSearchContext`).
- Casos de visibilidad (respetar): si **solo** face está activo → solo su botón; si **solo** dorsal → solo el
  suyo; si **ambos** → los dos lado a lado. La sección se oculta como hoy cuando `matches !== null` (hay búsqueda
  facial activa) y en eventos upcoming / sin fotos indexadas / minors.

## Criterio de aceptación (Definition of Done)
- [ ] Con face + dorsal activos, la sección "Encontrar mis fotos" muestra el título a la izquierda y **ambos
      botones a la derecha, en la misma fila** (desktop).
- [ ] Con **solo uno** activo, se muestra solo ese botón (sin huecos ni sección duplicada).
- [ ] **Mobile responsive**: distribución adecuada (apilado o fila compacta), sin overflow ni solape; tap targets
      correctos.
- [ ] Face matching sigue abriendo su flujo (modal) y el dorsal sigue buscando y filtrando la grilla; sin
      regresión funcional de ninguna de las dos búsquedas.
- [ ] Se aplica **igual en la vista pública** (`events/[shareCode]/page.tsx`) **y en la de talento**
      (`dashboard/talent/events/[id]/page.tsx`) — ambas usan `EventGalleryWithFaceSearch`.
- [ ] strings nuevos/renombrados en `en.json` y `es.json` (labels de los dos botones + título de sección;
      reusar `aiSearch.banner.*` y `bibDetection.*` donde aplique). Nada hardcodeado.
- [ ] test de la lógica de composición/visibilidad (qué botones se muestran según flags) que falle antes y pase
      después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/components/event-gallery-with-face-search.tsx` (composición/gating),
  `src/components/ai-find-photos-banner.tsx` (hoy tarjeta face), `src/components/bib-search-bar.tsx` (hoy tarjeta
  dorsal). Copys: `aiSearch.banner` y `bibDetection` en ambos diccionarios.
- **Dep de T-064**: ese ticket hace que el buscador por dorsal ya aparezca en la vista de talento y en la pública
  (prop + caché). Este rediseño asume que ambos ya se renderizan; ejecutar **después** de T-064 para no chocar en
  `event-gallery-with-face-search.tsx` / páginas de evento.
- Copy sugerido (a finalizar en implementación): EN "Face matching" / "Bib matching"; ES "Búsqueda facial" /
  "Búsqueda por dorsal". No bloqueante.
- Reportado sobre el mismo flujo de "Encontrar mis fotos" del evento público/talento.

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
