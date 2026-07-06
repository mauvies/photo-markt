# T-072 · Bug: evento con fotos subidas pero sin indexar aparece "sin fotos" (portada vacía) y no sale en listados públicos

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (fuertemente relacionado con T-071 — ver Notas)
- **Rama:** `fix/unindexed-event-hidden-empty-cover`  (tipo = fix)
- **OpenSpec change:** —  (se decide al ejecutar; parte de UI/query + una decisión de producto sobre visibilidad pública)
- **PR:** —

## Requerimiento
Tras crear un evento con 256 fotos (subidas 264) en local, con las fotos **subidas pero no indexadas**:
1. En el **dashboard del fotógrafo → listado de eventos**, la tarjeta muestra la portada vacía / "aún no se han subido fotos", pese a que ya hay 264 fotos subidas.
2. Como **usuario no autenticado en la home**, ese evento (público) **no aparece** en "eventos destacados"; presumiblemente tampoco en la sección "explorar" del dashboard de talento.

La usuaria sospecha que la condición para mostrar el evento/portada es tener al menos una foto **indexada/aprobada**, y como ninguna se indexa (por el bug ya reportado T-071), el evento no se muestra. **Revisar si ese es el caso** y decidir el comportamiento correcto: un evento con fotos subidas debería reflejarlo (al menos en la vista del propio dueño), aunque aún no estén indexadas.

## Criterio de aceptación (Definition of Done)
- [ ] Diagnóstico confirmado y documentado: la promoción a `upload_status='approved'` ocurre dentro del worker de indexado (`index-photo-faces.ts:159`); sin indexar → todas `pending` → portada owner (approved-only) vacía + listados públicos (approved-only) sin el evento
- [ ] **Tarjeta del dashboard del fotógrafo:** la portada/estado de la tarjeta del **dueño** refleja las fotos subidas (`pending + approved`, excluyendo `rejected`), no approved-only — el dueño no ve "sin fotos" cuando tiene 264 subidas (alinea el cover con lo que T-057 ya hizo para el **contador**)
- [ ] **Visibilidad pública** (destacados / explorar): decidido y documentado el comportamiento esperado — si un evento público con fotos solo `pending` debe mostrarse o no. Si se mantiene approved-only (moderación/calidad), documentar que la visibilidad pública **depende del indexado** (y por tanto de T-071); si se cambia, ajustar la query
- [ ] test de regresión que falla antes y pasa después (portada/estado de la tarjeta del dueño con fotos solo-pending)
- [ ] strings nuevos en `en.json` y `es.json` si cambia el copy del empty-state
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Causa raíz (investigada, capture-only):** los `photos` nacen `pending` y se promocionan a `approved` **dentro del worker de face indexing** (`src/lib/inngest/functions/index-photo-faces.ts:159` `update({ upload_status: 'approved' })`). La portada de la tarjeta del dueño usa `getPhotosForEvents` que es **approved-only** (documentado en T-057), y los listados públicos también filtran approved. Con el indexado caído, las 264 fotos quedan `pending` → portada vacía + evento invisible.
- **Relación con T-071 (no bloqueante duro):** T-071 es la causa de que en local **nada se indexe** (mismatch de entorno Inngest). Si se arregla T-071, las fotos se aprueban y todo se muestra. Pero hay una parte **independiente y arreglable ahora**: la tarjeta del **dueño** no debería decir "sin fotos" cuando hay fotos subidas-pero-pending — eso es un bug de UX real aunque el indexado funcione (durante la ventana pending). Esta es la mitad accionable sin depender de T-071.
- **Overlap con T-057:** T-057 (PR #115) ya hizo que el **contador** de la tarjeta use `pending+approved` (`getPhotoCountsForEvents`) pero dejó **a propósito** la **imagen de portada** en approved-only. Este ticket revisa justo esa portada del dueño. No re-hacer el contador.
- **Decisión de producto pendiente:** para superficies **públicas** (destacados/explorar), mostrar solo eventos con foto aprobada es defendible (no exponer fotos sin moderar/indexar). Confirmar la intención antes de relajar la query pública; el desbloqueo real de "no se ve en público" es que el indexado corra (T-071).
- **Puntos de código:** `src/database/queries/photos.ts` (`getPhotosForEvents` ~L212 approved-only; `getPhotoCountsForEvents` ~L244 pending+approved); listados públicos en `src/database/queries/events.ts` (destacados/explorar, filtros `is_public` ~L255/486/574 — revisar si además exigen foto aprobada).
- **Prioridad P2:** la mayor parte es downstream del bug ya reportado T-071; la parte independiente (portada del dueño) es UX confusa pero no rompe prod.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/unindexed-event-hidden-empty-cover`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
