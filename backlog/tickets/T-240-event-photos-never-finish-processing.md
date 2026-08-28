# T-240 · Las fotos de un evento no terminan de procesarse (evento `e5ae2822`)

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** normal  (sube a `alto` si el diagnóstico apunta a migración/BD — ver Notas)
- **Blockers:** ninguno
- **Rama:** `fix/event-photos-never-finish-processing`  (tipo = fix)
- **OpenSpec change:** —  (se decide al ejecutar, según lo que diga el diagnóstico)
- **PR:** —
- **Dep:** ninguna formal, pero **diagnosticar después de T-239**: si T-239 concluye que el entorno que
  ejecuta Inngest corre con un esquema viejo, este ticket probablemente sea el mismo defecto visto
  desde otra superficie y se cierre solo.

## Requerimiento

El usuario pregunta por qué en `/dashboard/photographer/events/e5ae2822-3faf-406b-8666-ab45be669cca`
las fotos **aún no se terminan de procesar bien**, y adjunta el error de Inngest de payouts que se
trata en T-239.

**El error de payouts no es la causa directa:** `retryPendingPayouts` y `indexPhotoFaces` son funciones
distintas, sobre tablas distintas, y un fallo de la primera no bloquea a la segunda ni consume su
concurrencia (`concurrency: { limit: 1 }` está scopeado por función).

**Pero puede compartir causa raíz.** Si T-239 confirma que el entorno que ejecuta estos jobs corre
contra una BD sin las migraciones últimas, entonces también le falta
`20260806000000_add_failed_to_upload_status`, y el fallo es exactamente el síntoma reportado:
`settleStrandedUploadStatus` intenta dejar la foto en `upload_status='failed'`, la CHECK
`photos_upload_status_check` (que en ese esquema solo admite `approved|pending|rejected`) lo rechaza con
`23514`, el `onFailure` del worker revienta → **la foto se queda en `pending` para siempre**: invisible
en las galerías (que solo pintan `approved`), ausente de la pestaña Pendientes (que excluye subidas del
dueño) y re-lanzada por el cron de reconciliación cada 30 min sin desenlace posible. Es literalmente el
bucle que T-231 cerró.

Hay que **medir antes de arreglar**: puede ser eso, o un atasco ordinario de los que T-099/T-183 ya
cubren, o fallos de AWS en ese evento concreto.

## Criterio de aceptación (Definition of Done)

- [ ] Diagnóstico escrito con datos reales del evento `e5ae2822-3faf-406b-8666-ab45be669cca`
      (consulta a prod vía MCP), como mínimo:
      - reparto de `photos` por `upload_status`, `face_index_status` y `thumbnail_status`
      - `events.ai_matching_status` / `bib_detection_status` y `updated_at`
      - `created_at` de las fotos atascadas (¿superan la ventana de 1 h del gate de obsolescencia?)
      - historial de runs de `indexPhotoFaces` / `generatePhotoThumbnails` para esas fotos en Inngest
- [ ] Identificado en cuál de los tres casos cae: (a) esquema viejo en el entorno → cierra con T-239;
      (b) atasco que la reconciliación debería sanar y no sana → arreglar la reconciliación;
      (c) fallo real de AWS/Storage por foto → dejar las fotos en `failed` para que el dueño las
      recupere con el flujo que ya existe
- [ ] Las fotos de ESE evento quedan resueltas (aprobadas, o en `failed` con la vía de recuperación del
      dueño visible), no simplemente explicadas
- [ ] Si el defecto es de código (no de entorno), test de regresión que falla antes y pasa después
- [ ] Si el fallo era invisible en el dashboard, la superficie del dueño lo dice: una foto que no puede
      terminar no debe presentarse igual que una que aún está en camino
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Recordatorio de la trampa de conteo al mirar esa página: el total de la rejilla es
`countEventPhotosByStatus(['approved','pending'])`, **no** `countEventPhotos` (ese es el contador del
tope de subida, donde una foto `failed` sigue ocupando bytes). Un desajuste entre «el dashboard dice N»
y «la galería pinta M» es esperado por diseño y no es en sí el bug.

Flujos ya existentes que probablemente basten para la recuperación, sin código nuevo:
`retryFailedUploadsAction` (re-emite `photo.uploaded`, limitado a 20/h porque cada foto puede disparar
trabajo facturable en AWS) y `discardFailedUploadsAction`.

Familia: **T-231** (estado `failed` + recuperación por el dueño) · **T-183/T-099** (reconciliación de
estado de indexado) · **T-239** (deriva de esquema en el entorno que ejecuta Inngest).

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
