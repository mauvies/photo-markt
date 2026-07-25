# T-183 · Fotos propias del fotógrafo atascadas en `pending` (dice 69, muestra 14)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/owner-uploads-stuck-pending`  (tipo = fix)
- **OpenSpec change:** —  (bug de reliability del worker + reconciliación; decidir al ejecutar)
- **PR:** —

## Requerimiento (reporte del usuario)
> "¿Por qué en `/en/dashboard/photographer/events/23245657-…` me dice que hay **69 photos y solo veo 14**?" — y en la vista de talento del mismo evento (`/dashboard/talent/events/marathon-paris-france-2026`) **solo se muestran 14** fotos (con la "puerta abierta", i.e. reveal gate off).

## Diagnóstico (verificado contra **staging** vía MCP — el entorno donde vive el evento; **no** está en prod)
Evento `23245657-809a-40f6-b73c-f8fb1c8cba45` ("Marathon Lyon France 2026", slug `marathon-paris-france-2026`), `type=collaborative`, `is_collaborative=true`, `require_upload_approval=true`, `is_public=true`, `ai_matching_enabled=true`, `ai_matching_status=idle`.

Breakdown de `photos` (deleted_at is null):
- **total = 69**, **approved = 14**, **pending = 55**.
- **Las 69 son subidas del OWNER**: `photos.user_id = events.user_id` **y** `guest_name IS NULL` para las 69 (0 con guest_name, `uploaded_by` null en todas).
- `thumbnail_status = 'ready'` para las **69** (el worker de thumbnails SÍ corrió).
- `face_index_status = 'not_applicable'` para las **69** (indexado facial nunca se hizo; ver T-184).

**Conclusión:** por la lógica de `promote-upload-status` (`src/lib/inngest/functions/index-photo-faces.ts:540-551`), una subida del owner (`photoUserId === eventOwnerId && guestName === null`) **siempre** se promueve a `approved` — **incluso** en el outcome `no-ai`, porque el step 3 solo se salta en `rejected`. Aun así **55 subidas del owner quedaron `pending`**. Las 14 approved prueban que el path funciona; las 55 significan que el step `promote-upload-status` **nunca se ejecutó/completó** para ellas (evento `photo.uploaded` perdido, run del worker caído a mitad, o throttling/desync en staging — el análogo del "Inngest prod sync drift").

**Por qué queda invisible y confunde:** el evento usa cola de moderación (`require_upload_approval` → `showPendingTab`), y la query de pending usa `excludeOwnerUploads: true` → las 55 subidas del owner **ni siquiera aparecen en la pestaña Pending**. Pero `countEventPhotos` cuenta las 69 → el fotógrafo ve "**69**" pero solo 14 fotos y una cola Pending vacía. En talento, la galería es approved-only → correctamente muestra 14 (las 55 pending nunca deben mostrarse a talento). **El bug real está del lado del fotógrafo: 55 fotos propias atascadas en `pending`, invisibles en todas las superficies.**

**Es el bug que T-174 no pudo verificar** (un `db:reset` le borró los datos y cerró por vía UX con `PhotosProcessingNotice`, que además solo aplica a eventos **no**-moderación → aquí ni se renderiza). Ahora los datos lo confirman.

**Gap del reconciliador (T-099):** `reconcileIndexingState` re-emite `photo.uploaded` solo para eventos atascados en `ai_matching_status='indexing'`. Aquí el status es **`idle`** (nunca entró a indexing porque AI no estaba on al subir) → **el reconciliador NO cubre este caso** (idle + owner uploads pending). Ese es el hueco.

## Criterio de aceptación (Definition of Done)
- [ ] Las subidas del owner **se auto-aprueban de forma confiable**, sin quedar a merced de un evento `photo.uploaded` que se pueda perder. Decidir el enfoque (ver Notas): (a) promover `upload_status='approved'` **síncronamente al insertar** las subidas del owner (nunca necesitan moderación), y/o (b) extender el reconciliador para cubrir owner-uploads `pending` en eventos con status `idle`.
- [ ] **Reconciliación de las filas ya atascadas**: las 55 (y cualquier otra igual) se promueven a `approved` — vía el reconciliador extendido o un backfill puntual — y se invalida el cache del evento (`invalidateEventPhotoCache`) para que aparezcan en público/talento sin esperar el TTL.
- [ ] El conteo del fotógrafo y las fotos visibles **cuadran**: no más "69 pero se ven 14" para subidas del owner (o, si hay pending legítimas de contribuidores, quedan reflejadas en la cola Pending, no invisibles).
- [ ] La vista de **talento** sigue mostrando approved-only (correcto) — este ticket no expone pending a talento.
- [ ] test de regresión que falla antes y pasa después: una subida del owner cuyo `photo.uploaded` no corrió (simular worker no ejecutado) termina `approved` tras el mecanismo elegido (insert síncrono o reconciliador); el reconciliador promueve un owner-upload `pending` en evento `idle`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Superficie:** `src/lib/inngest/functions/index-photo-faces.ts` (promote-upload-status), `src/lib/inngest/functions/reconcile-indexing.ts` (T-099), el insert de subidas (`attachPhotosToEvent`/`createPhoto`, hoy hardcodea `upload_status:'pending'`), `database/queries/photos.ts`, y el conteo en `dashboard/photographer/events/[id]/page.tsx` (`countEventPhotos` vs lo mostrado).
- **Recomendación de diseño:** hacer que la auto-aprobación del owner **no dependa** de un round-trip de Inngest es lo más robusto — las subidas del owner nunca requieren moderación, así que `createPhoto` podría insertarlas ya `approved` cuando el uploader es el owner (o promover en la misma Server Action de attach), dejando el worker solo para indexado/thumbnails. Evaluar el impacto en el flujo colaborativo (contribuidores sí deben entrar `pending`).
- **Diagnóstico reproducible:** queries MCP contra staging (`rozglsxdolgouslaojtm`). El evento NO está en prod (`yzdlueeeizdqwuicydbr`).
- **Relación:** familia T-174 (el fix real que aquel difirió a UX) / T-173 (misma raíz "superficies filtran por estado distinto"). **T-184** cubre el otro síntoma del mismo evento (búsqueda facial ausente).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/owner-uploads-stuck-pending`.
2. Si aplica, `/opsx:propose`; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
