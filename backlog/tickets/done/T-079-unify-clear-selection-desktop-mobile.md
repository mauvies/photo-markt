# T-079 · Unificar el control "Clear selection" en desktop con mobile (ícono X en vez de botón "Clear")

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/unify-clear-selection-desktop-mobile`  (tipo = fix)
- **OpenSpec change:** — (no aplicó — cambio acotado al componente compartido `photo-selection-toolbar.tsx`)
- **PR:** #142

## Requerimiento
En modo selección de fotos, desktop y mobile usan controles distintos para limpiar la selección: desktop tiene un botón "Clear"/"Limpiar" en la barra de acciones; mobile usa un ícono X a la izquierda del contador de seleccionadas (ej. "✕ 3 selected"). Unificar: desktop debe usar el mismo patrón que mobile (ícono X junto al contador) y el botón "Clear" desaparece de ambos.

Aplica a las vistas: `/dashboard/photographer/events/[id]`, `/dashboard/talent/events/[code]`, `/events/[code]` (pública), y la vista de resultados de búsqueda facial (si tiene modo selección).

**Reusar la implementación existente del ícono X de mobile** — no construir una paralela; preferir que la barra de selección sea un único componente/comportamiento compartido entre viewports.

## Criterio de aceptación (Definition of Done)
- [x] En desktop, el botón "Clear" desaparece de la barra de acciones en modo selección
- [x] En desktop, aparece el ícono X a la izquierda del contador de seleccionadas y limpia la selección al hacer click, igual que en mobile
- [x] El comportamiento en mobile no cambia
- [x] El comportamiento es consistente en las 4 superficies: dashboard fotógrafo, dashboard talento, evento público, resultados de búsqueda facial
- [x] Sin regresión en el modo selección, el resto de acciones de la barra, ni el contador de seleccionadas
- [x] strings: eliminadas las claves huérfanas `events.clearButton` y `talentPhotos.clear` (grep confirmó cero lectores tras el cambio)
- [x] test de regresión/feature que falla antes y pasa después (sin botón "Clear" + el X ya no lleva `md:hidden`)
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Ya es un componente compartido** (buena noticia — reduce el riesgo/alcance de este ticket): `src/components/photo-selection-toolbar.tsx` (`PhotoSelectionToolbar`) es el ÚNICO lugar que renderiza la barra de selección, consumido solo por `src/components/photo-gallery/photo-gallery.tsx` (`PhotoGallery`). Todas las superficies listadas ya pasan por ahí:
  - Fotógrafo: `dashboard/photographer/events/[id]/event-photo-album.tsx`
  - Talento: `dashboard/talent/events/[id]/event-photo-viewer.tsx`
  - Público: `events/[shareCode]/public-event-photo-viewer.tsx`
  - Búsqueda facial: `components/face-search-results.tsx` delega el render a un `renderGallery` callback del viewer host (mismo `PhotoGallery`/`PhotoSelectionToolbar` que la vista contenedora) — se arregla solo con el fix del componente compartido.
  - Bonus (no pedido pero se beneficia igual, mismo componente): `dashboard/talent/favorites/talent-photos-grid.tsx`, `dashboard/talent/profile/profile-photo-viewer.tsx`.
- **El fix es puntual dentro de `photo-selection-toolbar.tsx`:** hoy el botón X (`exitLabel`, aria-label `exitSelection`) ya existe pero tiene `md:hidden` (solo mobile); el botón "Clear" (`clearLabel`) está en un bloque `hidden ... md:flex` (solo desktop). El cambio es: quitar `md:hidden` del botón X (visible en todos los viewports) y borrar el bloque del botón "Clear" — ambos ya llaman a la misma prop `onClear`, así que el comportamiento (limpiar selección) no cambia, solo el control visual.
- **Strings a limpiar:** `clearLabel` se alimenta de dos claves distintas según la vista — `t('clearButton')` (fotógrafo, `en.json`/`es.json` línea ~205: "Clear"/"Limpiar") y `bulkDownload.clear` (talento + público, línea ~645: "Clear"/"Limpiar"). Verificado por grep: ningún otro lugar del código las usa — deberían poder eliminarse junto con el prop `clearLabel` de `PhotoSelectionToolbarProps`.
- **Prioridad P2:** pulido de consistencia UI, no es un bug funcional ni bloquea nada.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/unify-clear-selection-desktop-mobile`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
