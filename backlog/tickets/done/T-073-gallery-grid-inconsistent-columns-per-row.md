# T-073 · Bug: la galería del evento muestra columnas por fila inconsistentes (4 y luego 3), repitiéndose por cada página de paginación

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (fuerte solape con T-060 — misma ruta de render; ver Notas)
- **Rama:** `fix/gallery-grid-inconsistent-columns-per-row`  (tipo = fix)
- **OpenSpec change:** — (implementado directo — enfoque A, grid uniforme)
- **PR:** #133

## Requerimiento
En la galería de un evento (probado con 256 fotos), el grid renderiza las **primeras dos filas con 4 imágenes por fila y, a partir de la tercera fila, 3 por fila**, pese a que las fotos son (aparentemente) de las mismas dimensiones/tamaño. Al cargar la **siguiente página** de paginación (load-more, ~50 fotos), vuelve a pasar lo mismo: primeras filas con 4, luego 3, y así con cada nueva página. El grid debería mostrar un número de columnas por fila **consistente** en todas las filas y en todas las páginas cargadas.

## Criterio de aceptación (Definition of Done)
- [x] El grid de la galería muestra un número de columnas por fila consistente en todas las filas
- [x] El patrón inconsistente **no** se reinicia por cada página de load-more; las páginas cargadas se ven como una galería continua y homogénea
- [x] Se mantiene sin scroll-jump / sin reflow molesto al hacer load-more (la razón por la que hoy se segmenta)
- [x] Aplica a las 3 vistas que usan el álbum compartido (pública, dashboard talento, dashboard fotógrafo) — sin regresiones en ninguna
- [x] Responsive correcto (mobile/desktop) y sin romper la búsqueda facial/dorsal que comparten el mismo viewer
- [x] test de regresión/feature apropiado (helper de segmentación / cálculo de columnas)
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Resolución
**Causa raíz confirmada:** `RowsPhotoAlbum` (react-photo-album) es un layout justificado por filas — empaqueta fotos por fila según su aspect ratio real para acercarse a `targetRowHeight`, así que el número de fotos por fila varía (4 en unas, 3 en otras). Además, cada página de load-more se renderizaba como un segmento independiente (`photoSegments`), así que cada batch de ~50 fotos re-justificaba desde cero y repetía el mismo patrón.

**Fix (opción A del ticket, grid uniforme):** reemplazado por un grid CSS de columnas fijas responsive (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`) con tiles `aspect-square`/`object-cover` — toda fila mantiene el mismo número de columnas sin importar el aspect ratio de cada foto. La segmentación por página (`photoSegments`) se eliminó por completo: al no depender el tamaño del tile del aspect ratio de sus vecinos, las páginas de load-more se concatenan en un único grid continuo sin reflow ni scroll-jump (la razón original de segmentar).

Todo el cambio quedó centralizado en `photo-album-viewer.tsx` (usado por las 3 vistas — pública, dashboard talento, dashboard fotógrafo — vía `PhotoGallery`), así que no hizo falta tocar los 3 viewers por separado; la búsqueda facial/dorsal (que comparte el mismo viewer) no se vio afectada.

De paso: se retiró la dependencia `react-photo-album` (ya sin usos en el código) y los tiles pasan a `next/image` (consistente con `photo-carousel.tsx`/`event-card.tsx`; también resuelve la regla Biome `noImgElement` que la nueva implementación disparaba con un `<img>` plano).

**Tests:** nuevo `test/unit/components/photo-album-viewer.test.tsx` — un solo grid continuo (no uno por `itemBatches`) y clases de columna fijas idénticas independientemente del conteo de fotos.

## Notas (contexto de la investigación original)
- **Causa raíz (investigada, capture-only):** la galería usaba **`RowsPhotoAlbum`** de `react-photo-album` con `targetRowHeight={250}` + `rowConstraints={{ singleRowMaxHeight: 250 }}` (`src/components/photo-album-viewer.tsx:390-395`). Es un layout **justificado por filas**: calcula cuántas fotos caben por fila para acercarse a ~250px de alto según el **aspect ratio real** de cada foto. Aunque las fotos parezcan "del mismo tamaño" recortadas, sus dimensiones intrínsecas (`width`/`height`) varían → el algoritmo mete 4 en unas filas y 3 en otras. Eso, por diseño de la librería, producía columnas-por-fila variables.
- **Por qué se repetía por página:** el viewer renderizaba **cada página de load-more como un segmento independiente** (`segmentSizes` / `gridBatches` / `gridSegmentSizes`, `public-event-photo-viewer.tsx:440-455, 686`). Como cada segmento re-justificaba desde cero, cada batch de ~50 repetía la misma forma "primeras filas 4, luego 3". `photo-album-viewer.tsx:234-248` partía `photos` según `segmentSizes` y renderizaba un `RowsPhotoAlbum` por segmento.
- **Opciones de arreglo consideradas:**
  - **A (grid uniforme, elegida):** grid de columnas fijas (`grid grid-cols-N` responsive) con tiles recortados (`aspect-square`/`object-cover`), así toda fila tiene el mismo número de fotos independientemente del aspect ratio.
  - **B (justificado continuo, descartada):** dejar de segmentar y justificar todas las fotos cargadas como un solo álbum, resolviendo el scroll-jump de otra forma. Las filas seguirían variando 4/3 por aspect ratio, así que no cumplía del todo la expectativa de "columnas consistentes".
- **Solape con T-060:** T-060 (paginación load-more, ya mergeada — PR #123) era dueña del mismo mecanismo de `gridPages`/`segmentSizes`/`loadMore`; este bug vivía exactamente en esa ruta de render. Se ejecutó después de T-060, sin conflicto.
- **Puntos de código:** `src/components/photo-album-viewer.tsx` (algoritmo `RowsPhotoAlbum`, split por `segmentSizes` → ahora grid uniforme sin segmentación); `src/components/photo-gallery/photo-gallery.tsx` sin cambios (solo pasa `itemBatches` a través); los 3 viewers (`events/[shareCode]/public-event-photo-viewer.tsx`, `dashboard/talent/.../event-photo-viewer.tsx`, `dashboard/photographer/.../event-photo-album.tsx`) sin cambios — la lógica de layout estaba 100% centralizada en `photo-album-viewer.tsx`.
