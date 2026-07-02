# T-055 · Foto de presentación / portada del evento (configurable al crear)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/event-cover-photo`
- **OpenSpec change:** `add-event-cover-image` (proposal/specs/design/tasks). Archivar con `/opsx:archive` tras mergear #112.
- **PR:** #112

## Resolución (2026-07-02)
Decisión del usuario: **imagen de portada dedicada** (subida aparte de las fotos a la venta), no elegir una foto
del evento. Implementado: columna `events.cover_path`, subida owner-only validada (`validatePhotoUpload`) al
bucket `photos` (`${owner}/${event}/cover-<uuid>`), servida sin watermark vía signed URL; campo de portada en el
paso 2 del wizard (subida tras crear el evento, best-effort — un fallo de portada no descarta el evento, respeta
T-054); los 6 builders de `coverUrl` + la imagen OG/JSON-LD de la página pública del evento prefieren `cover_path`
con fallback a la primera foto; el cron de limpieza excluye portadas vivas (y ahora falla-seguro ante error de
lookup + ignora portadas de eventos borrados) y el borrado de evento elimina la portada. `/code-review high`
pasado y findings reales corregidos. Fuera de alcance (follow-up): cambiar/quitar la portada desde la edición del
evento tras crearlo.

## Requerimiento
El fotógrafo quiere poder **elegir la foto de presentación/portada** de cada evento (la imagen principal que
se muestra en el card del evento en los listados), **configurable al crear el evento**. Es importante para el
lanzamiento: hoy no se puede elegir.

## Contexto / diagnóstico (confirmado en código)
- **No existe** columna de portada en `events` (no hay `cover_photo_id`/`cover_url`). La portada se **auto-deriva**:
  se toma la **primera foto** que devuelve la query de fotos del evento como cover
  (`src/app/[lang]/dashboard/photographer/actions.ts:240`, `coverPathByEvent` = primer `original_url`). Mismo
  patrón en los demás builders de `coverUrl`.
- La **infra de mostrar** portada ya existe: `EventCard` acepta `coverUrl`/`coverThumbUrl`
  (`src/components/event-card.tsx`), y ~8 call sites la pasan (dashboard fotógrafo, explore/`top-events-actions`,
  talent, perfil público `photographer/[slug]`, guardados `saved-events`, featured, `events/page.tsx`).
- Falta: **persistir la portada elegida** y **UI para elegirla** en el wizard (y editar luego).

## Criterio de aceptación (Definition of Done)
- [ ] Al crear un evento, el fotógrafo puede designar **cuál es la foto de presentación** (según la estrategia
      elegida en Notas: elegir entre las fotos subidas, o subir una imagen de portada dedicada).
- [ ] La portada elegida se **persiste** (nueva columna en `events`) y se usa como `coverUrl` en **todos** los
      cards del evento (dashboard fotógrafo, explore, talent, perfil público, guardados, featured).
- [ ] **Fallback** al comportamiento actual (primera foto) cuando no se eligió portada — no romper eventos ya
      creados sin portada.
- [ ] (Deseable) poder **cambiar la portada** desde la edición del evento, no solo en la creación.
- [ ] **Privacidad/watermark:** asegurar que la portada pública no filtre un original sin marca de agua de una
      foto de pago (hoy el cover firma `original_url`; revisar al implementar — usar thumbnail/versión servible).
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test que falla antes y pasa después: la query/acción de listado devuelve la portada elegida (no la primera
      foto) cuando `events.cover_*` está seteado; fallback a primera foto cuando no.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Decisión de diseño (OpenSpec):**
  - **A. Elegir entre las fotos del evento:** `events.cover_photo_id` (FK a `photos`). Simple, reusa las fotos ya
    subidas y sus thumbnails. Requiere que haya fotos y define bien la privacidad (usar el thumbnail servible, no
    el original). Encaja con el wizard (marcar una de las que subes).
  - **B. Imagen de portada dedicada:** `events.cover_path` (objeto propio en Storage), independiente de las fotos
    a la venta. Permite portada aunque no haya fotos y evita filtrar originales, pero es una subida extra y otro
    objeto que gestionar/limpiar.
  - Recomendación inicial: **A** (menos fricción, reusa thumbnails), con la privacidad resuelta vía thumbnail.
- Coordinar con el wizard (`events/new/wizard.tsx`) — se solapa en archivos con T-052/T-054 (mismo wizard);
  ejecutar con esos mergeados para evitar conflictos.
- Al ser BD + pagos-adyacente (privacidad de originales), correr `/code-review` sobre el diff antes de commitear.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
