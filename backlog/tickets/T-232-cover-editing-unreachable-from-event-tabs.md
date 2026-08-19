# T-232 · La edición de portada existe pero es inalcanzable desde los tabs del evento

- **Prioridad:** P2
- **Estado:** doing
- **Riesgo:** normal  (UI + storage; ni pagos ni auth ni migraciones — reusa actions ya existentes)
- **Blockers:** ninguno
- **Rama:** `feat/event-cover-in-photos-tab`  (tipo = feat)
- **OpenSpec change:** —  (toca 2–3 archivos y el patrón ya existe dos veces en el repo; no amerita)
- **PR:** —

## Requerimiento (en palabras del usuario)
> No hay forma de editar la foto de portada de un evento. Por favor añadir un tab nuevo a la ruta
> `/dashboard/photographer/events/<id>` que se llame **Portada**, o incluir la posibilidad de editar
> la portada desde el tab de **Fotos**, donde consideres que sea más conveniente.

## Diagnóstico (verificado en código) — no es una feature ausente, es un hueco de descubribilidad
La edición de portada **ya existe y funciona** (T-166, PR #225): `EditEventForm`
(`events/[id]/edit/edit-event-form.tsx:325-358`) renderiza `<EventCoverField>`
(`src/components/event-cover-field.tsx`) con los tres estados (subir / preview+cambiar / quitar) y
persiste **al instante** vía `uploadEventCoverAction` / `removeEventCoverAction`
(`events/new/actions.ts`) — no espera al "Guardar cambios" (`detailsT.editCoverSavedInstantly`,
`es.json:1456`).

El problema es **cómo se llega ahí**. La página de detalle del evento navega por **tabs**
(`event-tab.ts:1` → `photos | details | pricing | share`), y:
- **ningún tab lleva a la portada**: `details` y `pricing` abren la **edición acotada**
  `/edit?section=info|settings|pricing` (`ScopedEventEditForm`), que documenta explícitamente que
  "Photos/cover are untouched" (`scoped-event-edit-form.tsx:41`);
- el formulario **completo** `/edit` (el único que muestra la portada) cuelga solo del menú "…"
  (`MoreVertical`) → "Editar evento" (`event-actions-menu.tsx:59-64`), un dropdown de icono sin
  etiqueta, al lado de "Eliminar evento".

Resultado: un fotógrafo que gestiona su evento por los tabs no encuentra nunca el control, y concluye
—como el usuario— que no se puede cambiar la portada. El coste del hueco es real: la portada es lo
único que decide cómo se ve el evento en las event cards y en el `og:image`.

## Decisión de ubicación: **dentro del tab de Fotos**, no un quinto tab
Recomendado el tab de **Fotos** por tres razones, y así se pide implementarlo:
1. **Precedente propio:** T-210 movió justamente la portada del paso de *detalles* al paso de
   **fotos** del wizard de creación. Poner la portada en Fotos alinea el detalle del evento con el
   alta; un tab "Portada" volvería a separarlas.
2. **Un tab para un único control** engorda una `TabsList` que ya lleva 4 entradas
   (`event-tabs.tsx:47-51`) y es la que peor escala en móvil.
3. Portada y fotos son la **misma tarea mental** ("el material visual del evento") y el mismo bucket
   de storage.

Se descarta explícitamente la alternativa del quinto tab; si al ejecutar se ve que el bloque compite
visualmente con la cuadrícula, la salida es colapsarlo (bloque compacto con preview pequeña), **no**
sacarlo a un tab.

## Criterio de aceptación (Definition of Done)
- [ ] El tab **Fotos** de `/dashboard/photographer/events/[id]` muestra un bloque de **portada** con
      los tres estados: sin portada (subir), con portada (preview + cambiar + quitar), reusando
      `<EventCoverField>` — sin reimplementar la UI ni el estilo.
- [ ] El bloque se sitúa **encima de la cuadrícula de fotos**, visualmente subordinado a ella (es un
      control, no la galería), y deja claro que la portada **no** es una foto a la venta del evento.
- [ ] Persiste llamando a `uploadEventCoverAction` / `removeEventCoverAction` **ya existentes** — no
      se crea action nueva, no se toca `updateEventAction`, no hay migración. Guardado inmediato con
      el mismo mensaje ya traducido (`editCoverSavedInstantly`), estado `busy` mientras sube y
      rollback de la preview optimista si el action falla (mismo patrón que `edit-event-form.tsx:163-193`).
- [ ] Solo el **dueño** del evento ve/usa el bloque: mismo gate que el resto de controles de gestión
      del tab (un colaborador/invitado no debe poder cambiar la portada del evento ajeno) — verificar
      qué exige hoy `uploadEventCoverAction` y no aflojarlo.
- [ ] Tras cambiar/quitar la portada, el cambio se refleja en las event cards y el `og:image`
      (invalidación de las tags del evento, igual que hace el flujo actual del `/edit`); la portada
      dedicada sigue **direct-signed** vía `signEventCoverUrls` — no pasa por `/api/watermark/`.
- [ ] El control del `/edit` completo **sigue funcionando** (no se mueve ni se rompe): esto añade un
      punto de entrada, no migra el existente.
- [ ] strings nuevos en `en.json` y `es.json` **solo si hacen falta** — la intención es reusar
      `coverLabel` / `coverDesc` / `coverInfoAria` / `coverSelect` / `coverRemove` y
      `editCoverSavedInstantly`, sin duplicar.
- [ ] test de regresión/feature que falla antes y pasa después: guard de que el tab de Fotos renderiza
      el campo de portada y que cambiarla/quitarla llama al action correspondiente.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — no hay pérdida de datos ni dinero en juego y **existe workaround** (menú "…" → Editar
  evento), pero el usuario lo topó de frente y creyó que la feature no existía, que es el síntoma
  clásico de un hueco de UX que cuesta soporte. Por eso no baja a P3.
- **Evento del reporte:** `fb4ed048-dcc7-42ed-a001-3eaa678ac0fb`.
- **No duplica a T-166** (done, PR #225): aquel construyó la capacidad, este la hace alcanzable.
- **Solapa en archivos con T-231** (`events/[id]/page.tsx`, tab de fotos — rama
  `fix/stuck-pending-upload-recovery` en curso) y con T-229/T-230 solo de refilón. **Ejecutar después
  de mergear T-231** para no pelear con el mismo tab de fotos.
- Al ejecutar, considerar si conviene que el bloque también aparezca cuando el evento **no tiene
  ninguna foto** todavía (hoy el tab de fotos en ese estado muestra el vacío/dropzone): definir una
  portada antes de subir fotos es un caso legítimo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-cover-in-photos-tab`.
2. Montar el bloque de portada en el tab de Fotos reusando `<EventCoverField>` +
   `uploadEventCoverAction`/`removeEventCoverAction`, con gate de dueño e invalidación de cache + test.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
