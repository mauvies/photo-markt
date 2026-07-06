# T-073 · Bug: la galería del evento muestra columnas por fila inconsistentes (4 y luego 3), repitiéndose por cada página de paginación

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (fuerte solape con T-060 — misma ruta de render; ver Notas)
- **Rama:** `fix/gallery-grid-inconsistent-columns-per-row`  (tipo = fix)
- **OpenSpec change:** —  (se decide al ejecutar según el enfoque: grid uniforme vs album justificado continuo)
- **PR:** —

## Requerimiento
En la galería de un evento (probado con 256 fotos), el grid renderiza las **primeras dos filas con 4 imágenes por fila y, a partir de la tercera fila, 3 por fila**, pese a que las fotos son (aparentemente) de las mismas dimensiones/tamaño. Al cargar la **siguiente página** de paginación (load-more, ~50 fotos), vuelve a pasar lo mismo: primeras filas con 4, luego 3, y así con cada nueva página. El grid debería mostrar un número de columnas por fila **consistente** en todas las filas y en todas las páginas cargadas.

## Criterio de aceptación (Definition of Done)
- [ ] El grid de la galería muestra un número de columnas por fila consistente en todas las filas
- [ ] El patrón inconsistente **no** se reinicia por cada página de load-more; las páginas cargadas se ven como una galería continua y homogénea
- [ ] Se mantiene sin scroll-jump / sin reflow molesto al hacer load-more (la razón por la que hoy se segmenta)
- [ ] Aplica a las 3 vistas que usan el álbum compartido (pública, dashboard talento, dashboard fotógrafo) — sin regresiones en ninguna
- [ ] Responsive correcto (mobile/desktop) y sin romper la búsqueda facial/dorsal que comparten el mismo viewer
- [ ] test de regresión/feature apropiado (helper de segmentación / cálculo de columnas)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Causa raíz (investigada, capture-only):** la galería usa **`RowsPhotoAlbum`** de `react-photo-album` con `targetRowHeight={250}` + `rowConstraints={{ singleRowMaxHeight: 250 }}` (`src/components/photo-album-viewer.tsx:390-395`). Es un layout **justificado por filas**: calcula cuántas fotos caben por fila para acercarse a ~250px de alto según el **aspect ratio real** de cada foto. Aunque las fotos parezcan "del mismo tamaño" recortadas, sus dimensiones intrínsecas (`width`/`height`) varían → el algoritmo mete 4 en unas filas y 3 en otras. Eso, por diseño de la librería, produce columnas-por-fila variables.
- **Por qué se repite por página:** el viewer renderiza **cada página de load-more como un segmento independiente** (`segmentSizes` / `gridBatches` / `gridSegmentSizes`, `public-event-photo-viewer.tsx:440-455, 686`). El comentario lo dice: *"keep each load-more page as its own filtered batch so the gallery lays them out as independent segments (no reflow / scroll-jump on append)"*. Como cada segmento re-justifica desde cero, cada batch de ~50 repite la misma forma "primeras filas 4, luego 3". `photo-album-viewer.tsx:234-248` parte `photos` según `segmentSizes` y renderiza un `RowsPhotoAlbum` por segmento.
- **Opciones de arreglo (decidir al ejecutar):**
  - **A (grid uniforme, recomendada por lo que reporta la usuaria):** cambiar a un grid de columnas fijas (`grid grid-cols-N` responsive) con tiles recortados (`aspect-square`/`object-cover`), así toda fila tiene el mismo número de fotos independientemente del aspect ratio. Cambia la estética de "justificado" a "cuadrícula uniforme".
  - **B (justificado continuo):** dejar de segmentar y justificar **todas** las fotos cargadas como un solo álbum, resolviendo el scroll-jump de otra forma (p.ej. preservar scroll anchor). Las filas siguen variando 4/3 por aspect ratio, así que **no** cumple del todo la expectativa de "columnas consistentes" — por eso se prefiere A.
- **Solape con T-060 (currently `doing`):** T-060 (paginación load-more de la galería en las 3 vistas) es dueño de este mismo mecanismo de `gridPages`/`segmentSizes`/`loadMore`. Este bug vive exactamente en esa ruta de render. Coordinar: idealmente ejecutar **después de** T-060 (o plegarlo dentro), para no chocar. Marcar dependencia blanda con T-060.
- **Puntos de código:** `src/components/photo-album-viewer.tsx` (algoritmo `RowsPhotoAlbum`, split por `segmentSizes`), `src/components/photo-gallery/photo-gallery.tsx`, y los 3 viewers (`events/[shareCode]/public-event-photo-viewer.tsx`, `dashboard/talent/.../event-photo-viewer.tsx`, `dashboard/photographer/.../event-photo-album.tsx`).
- **Prioridad P2:** bug de consistencia visual en la galería core; molesto pero no bloqueante.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/gallery-grid-inconsistent-columns-per-row`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
