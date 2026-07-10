# T-109 · Fix: fotos del organizador en la cola de aprobación + UI de aprobación con acciones batch

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/owner-upload-approval-queue-batch-ui`
- **OpenSpec change:** — (implementado directo: bug-fix + rediseño UI, sin migración/pagos)
- **PR:** #154

## Requerimiento

Dos partes relacionadas (mismo componente — la cola de aprobación del organizador en `/dashboard/photographer/events/[id]`), pedidas juntas por el usuario:

**Parte 1 — Bug:** las fotos subidas por el propio dueño del evento aparecen en la pestaña "Pending" de aprobación, pese a que `index-photo-faces.ts` ya implementa auto-approve incondicional para uploads del dueño (`isOwnerUpload` en el step `promote-upload-status`, líneas 539–558). Investigar causa raíz y corregir para que las fotos del dueño —vía **cualquier** path de subida, incluido el wizard de creación— nunca aparezcan en la cola, sin debilitar `require_upload_approval` para contribuidores/invitados.

**Parte 2 — UI:** rediseñar los botones individuales approve/reject (iconografía clara, buen touch target mobile), añadir acciones batch (reusando el patrón de selección ya existente en galerías), y reemplazar el `window.confirm()` nativo por el modal de confirmación estándar de la app — **solo para reject**, approve sigue sin confirmación.

## Causa raíz investigada (pre-implementación, confirmar antes de tocar código)

Investigación de código ya hecha (sin implementar aún):

1. **El auto-approve del dueño SÍ es correcto y único** — `index-photo-faces.ts:539–558`, step `promote-upload-status`:
   ```
   isOwnerUpload = photoUserId === eventOwnerId && photoGuestName === null
   → si isOwnerUpload: promoteToApproved() incondicional, sin mirar require_upload_approval
   ```
2. **No hay divergencia entre el wizard y la subida normal** — ambos paths (`events/new/wizard.tsx` y `organizer-upload-section.tsx` en el evento ya creado) usan el mismo hook compartido `src/lib/use-photo-upload.ts` → misma Server Action `attachPhotosToEvent` (`upload-urls/actions.ts:429–543`). `user_id`/`guest_name` se atribuyen igual en ambos casos — **no es un bug de atribución por path**.
3. **Causa raíz real (hipótesis fuerte, a confirmar contra datos del evento reportado):** `attachPhotosToEvent` inserta **toda** foto — dueño incluido — con `upload_status: 'pending'` hardcodeado (`upload-urls/actions.ts:503,487`; ver también `createPhoto`/`uploadGuestPhoto` en `src/database/queries/photos.ts:558–643`). El único lugar que promueve `pending → approved` es el step asíncrono `promote-upload-status` dentro del worker Inngest `photo.uploaded` — **no hay auto-approve síncrono en el insert**. La pestaña "Pending" (`pending-photos-tab.tsx`, alimentada por `page.tsx:126`: `getEventPhotos(..., { status: 'pending', skipUserIdFilter: true })`) trae **todas** las fotos `pending` del evento **sin filtrar por dueño vs. contribuidor** — así que:
   - **Ventana de carrera:** si el fotógrafo carga la página entre el insert y que el worker corra el step de promoción, su propia foto aparece momentáneamente en la cola.
   - **Bug permanente (más probable causante del reporte):** si el worker falla antes de llegar a `promote-upload-status` (falla de un step previo, `onFailure` tras agotar reintentos, error de red/AWS, etc.), la foto del dueño queda en `pending` **para siempre** — sin mecanismo de reconciliación — y permanece visible en la cola de aprobación indefinidamente. No confundir con T-099 (sweeper de reconciliación de `face_index_status`/`thumbnail_status`) — ese ticket no cubre `upload_status`.
4. **Dato de código muerto/sospechoso a revisar durante el fix:** `upload-urls/actions.ts:535–538` calcula `flow.requireApprovalAfterValidation` y lo descarta explícitamente (`void flow.requireApprovalAfterValidation;`) con un comentario que dice que el worker lee `require_upload_approval` "at validate time" — confirmar si ese campo computado tiene algún uso real pendiente o es vestigio a limpiar.

**Investigar contra el evento real reportado antes de aplicar el fix** (según pide el ticket original): confirmar en la fila de `photos` si el caso fue la ventana de carrera (foto luego promovida) o el caso permanente (foto quedó pending sin que el worker la promoviera — revisar logs de Inngest / `face_index_status` de esa foto para ver en qué step se detuvo).

**Fix a implementar** (ajustar según lo que confirme la investigación):
- Opción principal: la query que alimenta la pestaña "Pending" (`getEventPhotos(..., { status: 'pending' })` en `page.tsx:126`) debe **excluir** fotos donde `user_id === event.user_id AND guest_name IS NULL` — nunca deben aparecer ahí, sean cuales sean su estado transitorio o el resultado del worker.
- Adicionalmente, evaluar si conviene que `promote-upload-status` (o un fallback) resuelva también el caso "worker falló antes de promover" para fotos del dueño ya varadas en `pending` — documentar la decisión (out of scope si se prefiere cubrirlo en un sweeper futuro tipo T-099, pero dejarlo explícito).

## Criterio de aceptación (Definition of Done)

- [ ] Causa raíz documentada en el PR/commit (confirmada contra el evento real, no solo la hipótesis de código).
- [ ] Fotos del dueño del evento —vía cualquier path de subida, incluido el wizard— nunca aparecen en la pestaña "Pending", sea cual sea el estado transitorio del worker.
- [ ] Uploads de contribuidores/invitados siguen honorando `require_upload_approval` sin regresión (test existente de ese flujo sigue en verde + nuevo test de no-regresión).
- [ ] Botones individuales approve/reject rediseñados: iconografía clara y distinta (check en tono positivo, reject en tono neutro/muted — sin rojo/verde chillón si no encaja con el design system), buen touch target en mobile.
- [ ] Approve (individual y "Approve all") ejecuta inmediato, sin modal de confirmación — solo loading state + toast de éxito.
- [ ] Reject (individual y batch) abre el modal de confirmación estándar de la app (mismo componente Dialog/AlertDialog que usa la confirmación de borrado de foto) — **elimina el `window.confirm()` nativo** de `pending-photos-tab.tsx:56`.
- [ ] Se puede seleccionar fotos reusando el patrón de selección existente (`PhotoSelectionToolbar` / `usePhotoSelection`, hoy solo cableado en `photo-gallery.tsx`) para batch approve/reject.
- [ ] "Approve all" (todas las pendientes) y batch approve/reject de la selección, con loading state + toast de éxito/error, igual que otras acciones batch de la app.
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión (falla antes / pasa después) para el bug de Parte 1 + tests de la nueva UI batch.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

- Componente: `src/app/[lang]/dashboard/photographer/events/[id]/pending-photos-tab.tsx`.
- Server actions actuales: `approvePendingPhotoAction`/`rejectPendingPhotoAction` en `src/app/[lang]/dashboard/photographer/events/[id]/actions.ts:473–535`. `rejectPendingPhotoAction` hace **hard delete** de la foto (sin undo) — el modal de confirmación de reject debe dejar eso claro en el copy, igual que la confirmación de borrado de foto ya existente.
- El worker escribe `upload_status` con updates admin inline (`promoteToApproved`/`markRejected` en `index-photo-faces.ts`), **no** a través de la query compartida `updatePhotoUploadStatus` (`photos.ts:824–841`) que sí usa `approvePendingPhotoAction`. Dos mecanismos distintos escribiendo la misma columna — tenerlo presente al tocar el flujo, no es necesariamente parte del bug pero es contexto relevante.
- Patrón de selección a reusar: `src/components/photo-selection-toolbar.tsx` + `src/hooks/use-photo-selection.ts` (hoy solo consumidos por `src/components/photo-gallery/photo-gallery.tsx`).
- Alcance: `/dashboard/photographer/events/[id]`, pestaña "Pending" (solo visible cuando `eventUsesModerationQueue(event)` es true).
