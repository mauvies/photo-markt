# T-166 · No se puede agregar/cambiar la cover photo al editar un evento

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/edit-event-cover-photo`  (tipo = feat)
- **OpenSpec change:** —  (feature de UI + storage; el patrón ya existe en el wizard de creación, requerimiento claro — evaluar OpenSpec al ejecutar solo si el action de update se complica)
- **PR:** —

## Requerimiento (reporte del usuario)
> Al editar un evento desde el dashboard de fotógrafos, **no existe la posibilidad de agregar o
> modificar la cover photo**.

## Causa (verificada en código)
El formulario de edición (`src/app/[lang]/dashboard/photographer/events/[id]/edit/`) **no incluye
ningún campo de portada** — `cover` solo aparece como `object-cover` (CSS) y un comentario; no hay
selector/preview/subida de portada en `components/event-form-fields.tsx`, `edit-event-form.tsx` no tiene
estado `coverFile` ni lee `event.cover_path` en sus `defaultValues`, y el `updateEventAction`
(`edit/actions.ts`) **ni acepta ni escribe `cover_path`** (su schema/parse/updateData no lo mencionan).
El `Dropzone` del edit form alimenta fotos normales (`usePhotoUpload`), **no** la portada.

En cambio, el **wizard de creación** SÍ lo tiene: UI en
`events/new/steps/step-3-details.tsx` (subir/cambiar/quitar, con tooltip tras T-149) + estado
`coverFile` en `events/new/wizard.tsx`, y persistencia vía **`uploadEventCoverAction`** /
**`removeEventCoverAction`** (`events/new/actions.ts`) que suben al bucket `photos` en
`${user.id}/${eventId}/cover-<uuid>.<ext>` y llaman `setEventCoverPath`. La portada dedicada vive en
`events.cover_path` (T-055) y siempre se firma directa vía `signEventCoverUrls` /
`resolveEventOgImageUrl` (`src/database/queries/event-covers.ts`). **Reusar esas mismas actions** desde
el edit form (no reimplementar) es el camino directo.

Resultado: una portada solo se puede definir **al crear** el evento; después es inmodificable desde
la app (hay que recrear el evento o tocar la BD). Es un hueco funcional real de la gestión de eventos.

## Criterio de aceptación (Definition of Done)
- [ ] El formulario de edición de evento (`event-form-fields.tsx` / `edit-event-form.tsx`) muestra un
      campo de **portada** con los tres estados del wizard: sin portada (subir), con portada (preview +
      cambiar + quitar) — reusando el mismo patrón/UX que `events/new/steps/step-3-details.tsx`
      (idealmente extrayendo el bloque a un componente compartido para que las dos superficies no
      dividan estilos, en la línea de otros refactors compartidos del repo).
- [ ] El `updateEventAction` (`edit/actions.ts` + `edit-event-schema.ts`) persiste `events.cover_path`:
      subir una nueva portada, reemplazar la existente, y quitarla (dejar `cover_path` null). La subida
      valida vía `src/lib/photo-upload.ts` (magic-bytes, 50 MB, content-type derivado) como todo upload.
- [ ] Al reemplazar/quitar la portada, el objeto de storage anterior se limpia (sin huérfanos) — mismo
      criterio que el create; confirmar que no rompe `signEventCoverUrls` (portada dedicada = siempre
      direct-signed, no es fila de `photos`).
- [ ] La portada editada se refleja en las event cards / og:image (cache busting de las tags del evento
      si aplica, como hacen otros cambios de evento).
- [ ] strings nuevos en `en.json` y `es.json` si el bloque de portada del edit no reusa los del create
      (idealmente reusar `coverLabel`/`coverDesc`/`coverInfoAria` existentes — sin duplicar).
- [ ] test de regresión/feature que falla antes y pasa después: `updateEventAction` set/replace/clear de
      `cover_path` (integración del action) y/o guard source-level de que el campo de portada existe en
      el edit form.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — hueco funcional de gestión de eventos que el usuario topó directamente; hay workaround
  parcial (definir portada al crear), por eso no es P1.
- **Cluster con T-167** (mismo archivo `event-form-fields.tsx`, mismo edit form): coordinar merge o
  ejecutar contiguos. T-167 es un fix de layout aislado (CSS), este es la feature más grande.
- Reusar el patrón de portada del wizard de creación (T-055/T-149); no reinventar la subida ni el
  firmado (`event-covers.ts`).
- Toca **storage** (subida/borrado de portada) — al ejecutar, evaluar si amerita `/code-review`
  (upload path) aunque no toque pagos/auth; mínimo aplicar `validatePhotoUpload`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/edit-event-cover-photo`.
2. Reusar el bloque de portada del create wizard (extraer a componente compartido si conviene) +
   cablear `updateEventAction`/schema para persistir `cover_path` (set/replace/clear + limpieza de
   storage) + test.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
