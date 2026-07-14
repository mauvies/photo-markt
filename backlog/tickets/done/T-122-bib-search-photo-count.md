# T-122 · Fix: el contador de fotos de la toolbar no refleja los resultados de una búsqueda por dorsal

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/bib-search-photo-count`
- **OpenSpec change:** —  (fix acotado en dos viewers)
- **PR:** #182

## Requerimiento
Al hacer una **búsqueda por dorsal** que matchea, p. ej., 3 fotos, la galería muestra esas 3 — pero el
**contador "Fotos (N)"** justo encima de la galería sigue mostrando el **total de fotos del evento** en vez
del total **mostrado en ese momento** (3). Debería mostrar **"Fotos (3)"** mientras la búsqueda por dorsal
está activa (y volver al total del evento al limpiar la búsqueda).

## Estado actual (verificado en el código)
- El contador de la toolbar (T-104, PR #169) usa `totalCount` (total real del evento server-side) en
  `toolbarLeading`, sin importar si hay un filtro de búsqueda por dorsal activo.
- Con `bibActive` (`bibSearch.matchedPhotoIds !== null`), la galería renderiza `items={bibVisiblePhotos}`
  (los matches) pero `toolbarLeading` sigue pasando `totalCount` → el label muestra el total del evento, no
  el nº de matches. Pasa en **ambos** viewers:
  - Pública: `src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx` (`bibActive` ~L521,
    `bibVisiblePhotos` ~L531, `toolbarLeading` ~L750, `items` ~L761).
  - Talento: `src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx` (`bibActive` ~L441,
    `bibVisiblePhotos` ~L453, `toolbarLeading` ~L740, `items` ~L758).
- **Face search** es otro camino: cambia a `FaceSearchResults` (toolbar propio con botón "ver todas"), no
  muestra este contador → fuera de alcance aquí (comportamiento intencional de T-104).

## Criterio de aceptación (Definition of Done)
- [ ] Con una búsqueda por dorsal activa, el contador standalone muestra el **nº de fotos que matchean/se
      muestran** (`bibVisiblePhotos.length`), p. ej. "Fotos (3)" / "Photos (3)".
- [ ] Al limpiar la búsqueda por dorsal, el contador vuelve al **total del evento** (comportamiento T-104).
- [ ] Aplica a la vista pública y a la de talento (mismo patrón).
- [ ] **Eventos colaborativos (con tabs "All/My"):** decidir y documentar — durante una búsqueda por dorsal,
      que el count de "All photos (N)" refleje el nº de matches (coherente con "lo que se muestra") o se
      mantengan las tabs con su total; recomendado: reflejar el nº mostrado mientras el filtro está activo,
      igual que el label standalone. (Nota: los conteos por-tab All/My fuera de búsqueda siguen siendo
      totales por-tab, eso no cambia.)
- [ ] Sin regresión en el contador cuando no hay búsqueda activa (sigue mostrando el total del evento).
- [ ] Sin strings i18n nuevos (reusa `events.photosCount`; el número es dato).
- [ ] test de regresión/feature que falla antes y pasa después (bib activo → count = nº de matches; sin bib
      → count = total del evento).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Fix:** en el `toolbarLeading` de ambos viewers, cuando `bibActive`, usar `bibVisiblePhotos.length` en vez
  de `totalCount` para el `EventPhotoCountLabel` (y, según la decisión de arriba, para el `allCount` de
  `EventPhotoFilterTabs` en colaborativo). Componentes: `EventPhotoCountLabel` / `EventPhotoFilterTabs`
  (`src/components/`), sin cambios de API — solo el número que se les pasa.
- **Follow-up de T-104** (PR #169, ya en main). No confundir con face search (camino distinto).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bib-search-photo-count`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
