# T-072 · Bug: evento con fotos subidas pero sin indexar aparece "sin fotos" (portada vacía) y no sale en listados públicos

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (fuertemente relacionado con T-071 — ver Notas)
- **Rama:** `fix/unindexed-event-hidden-empty-cover`  (tipo = fix)
- **OpenSpec change:** — (no aplicó — UI/query + decisión de producto, sin cambio arquitectónico)
- **PR:** #132

## Requerimiento
Tras crear un evento con 256 fotos (subidas 264) en local, con las fotos **subidas pero no indexadas**:
1. En el **dashboard del fotógrafo → listado de eventos**, la tarjeta muestra la portada vacía / "aún no se han subido fotos", pese a que ya hay 264 fotos subidas.
2. Como **usuario no autenticado en la home**, ese evento (público) **no aparece** en "eventos destacados"; presumiblemente tampoco en la sección "explorar" del dashboard de talento.

La usuaria sospecha que la condición para mostrar el evento/portada es tener al menos una foto **indexada/aprobada**, y como ninguna se indexa (por el bug ya reportado T-071), el evento no se muestra. **Revisar si ese es el caso** y decidir el comportamiento correcto: un evento con fotos subidas debería reflejarlo (al menos en la vista del propio dueño), aunque aún no estén indexadas.

## Criterio de aceptación (Definition of Done)
- [x] Diagnóstico confirmado y documentado: la promoción a `upload_status='approved'` ocurre dentro del worker de indexado (`index-photo-faces.ts` step "promote-upload-status"); sin que el worker corra (T-071) → todas quedan `pending` → portada owner (approved-only) vacía + listados públicos (approved-only) sin el evento
- [x] **Tarjeta del dashboard del fotógrafo:** la portada/estado de la tarjeta del **dueño** refleja las fotos subidas (`pending + approved`, excluyendo `rejected`), no approved-only — el dueño no ve "sin fotos" cuando tiene 264 subidas (alinea el cover con lo que T-057 ya hizo para el **contador**)
- [x] **Visibilidad pública** (destacados / explorar): decidido y documentado — ver "Decisión de producto confirmada" abajo
- [x] test de regresión que falla antes y pasa después (portada/estado de la tarjeta del dueño con fotos solo-pending)
- [x] strings nuevos en `en.json` y `es.json` si cambia el copy del empty-state — **N/A**, no cambió copy (ver Notas)
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

### Diagnóstico confirmado
Los `photos` nacen `pending` y se promocionan a `approved` dentro del step "promote-upload-status" de `index-photo-faces.ts` — **independientemente de si el evento tiene AI matching habilitado o no** (ese step siempre corre para outcomes no-rechazados; el branch de AWS/indexado es un paso previo separado que solo decide si hay `photo_faces` que persistir). Es decir: la aprobación NO es intrínsecamente "indexado facial" — es "el worker de `photo.uploaded` corrió y validó los bytes". Con el worker caído (T-071 en local) o simplemente mientras está en la ventana `pending`, las fotos quedan sin aprobar → portada vacía (owner, approved-only) + evento invisible en destacados (approved-only, `count>=1`).

`getPhotosForEvents` (portada) es approved-only (documentado en T-057, que ya arregló el **contador** a `pending+approved` pero dejó la portada intacta a propósito). Los listados públicos ("destacados" en `top-events-actions.ts`) también exigen `count>=1` approved-only. **"Explorar"** (`searchPublicEvents`) en cambio **no filtra por fotos aprobadas en absoluto** — el evento sí aparece ahí, solo con la portada vacía (mismo síntoma de portada, no de inclusión).

### Decisión de producto confirmada (usuario)
Mantener el gate approved-only en "destacados" **pero solo para eventos con AI matching configurado** (`events.ai_matching_enabled`). Razonamiento: la aprobación real SÍ es una espera con sentido cuando el pipeline de indexado va a correr sobre esa foto (moderación/calidad vía el mismo paso); pero para un evento **sin** AI matching, no hay ningún pipeline por el que esperar — exigir "approved" solo refleja si el worker (trivial, sin AWS) ya corrió, no ninguna moderación real. Implementado como un helper puro `resolvePublicEventCoverStats` (`src/lib/event-cover-stats.ts`, testeado exhaustivamente): por evento, si `ai_matching_enabled` cuenta/cubre solo `approved`; si no, cuenta/cubre `pending+approved`. Aplicado en:
- `top-events-actions.ts` (destacados home)
- `dashboard/talent/events/actions.ts` (búsqueda/"explorar")

La tarjeta del **dueño** (`dashboard/photographer/events/page.tsx` + overview de `dashboard/photographer/actions.ts`) usa `pending+approved` **incondicionalmente** (sin chequear AI) — el dueño debe ver sus propias fotos subidas siempre, sin importar la config de IA del evento.

Nueva query `getPhotosForEventsIncludingPending` (`src/database/queries/photos.ts`) — mismo shape que `getPhotosForEvents` pero `pending+approved` (excluye `rejected`), incluye `upload_status` en el select para que el helper puro pueda decidir.

**Sin cambio de copy:** el empty-state (`t.noPhotosYet`) sigue siendo correcto — solo se muestra ahora cuando de verdad no hay ninguna foto subida (0 pending+approved), no cuando hay 264 pendientes. No se necesitan strings nuevos.

**No tocado (fuera de alcance, no mencionado en el reporte):** perfil público del fotógrafo (`photographer/[slug]/actions.ts`) y eventos guardados de talent (`saved-events.ts`) tienen el mismo patrón approved-only en su portada — posible follow-up si se quiere consistencia total, pero no forman parte del bug reportado.

### Overlap con T-057
T-057 (PR #115) ya hizo que el **contador** de la tarjeta use `pending+approved` (`getPhotoCountsForEvents`) pero dejó a propósito la portada en approved-only. Este ticket cierra esa brecha para la portada del dueño, y extiende el mismo principio (condicionado a AI) a las superficies públicas.

**Prioridad P2:** la mayor parte era downstream del bug ya reportado T-071 (worker caído en local); la parte de portada del dueño y la condicional AI en público son mejoras de UX reales, no bloqueantes de prod.

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
