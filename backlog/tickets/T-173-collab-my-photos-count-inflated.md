# T-173 · Conteo "My photos" inflado en eventos colaborativos (My > All, incluye pendientes)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/collab-my-photos-count`  (tipo = fix)
- **OpenSpec change:** —  (bug de query/conteo acotado; no toca pagos/auth)
- **PR:** —

## Requerimiento (reporte del usuario)
> En `/dashboard/talent/events/marathon-paris-france-2026` sale **"All photos (14)"** y **"My photos (69)"**.
> Y en `/en/dashboard/photographer/events/23245657-809a-40f6-b73c-f8fb1c8cba45` sale un total de **69**
> fotos pero realmente hay **14**.

## Causa raíz (confirmada — código + datos de staging)
El evento vive en **staging** (`rozglsxdolgouslaojtm`), id `23245657-809a-40f6-b73c-f8fb1c8cba45`,
`is_collaborative=true`, `allow_guest_upload=true`, **`require_upload_approval=true`**, owner
`07cf6833-…`. Datos reales (MCP, read-only):
- **69 fotos** totales: **14 `approved` + 55 `pending`** (`photos.upload_status`). Todas son subidas de
  **invitado** (`uploaded_by = null`) y **todas** tienen `photos.user_id = 07cf6833` (**el owner**).
- 0 `photo_faces`, 0 `talent_photo_tags` → "My photos" por match facial/tag debería ser **0**.

Desglose de los conteos de la UI:
- **"All photos (14)"** = `totalCount` = fotos **approved** visibles al talento → **correcto**.
- **"My photos (69)"** = `uploadedPhotoIds.size` → viene de
  `getUploadedPhotoIdsForUserInEvent` (`src/database/queries/photos.ts:522`), que filtra:
  ```
  .eq('event_id', eventId).is('deleted_at', null)
  .or(`user_id.eq.${userId},uploaded_by.eq.${userId}`)
  ```
  **`photos.user_id` es el OWNER del evento, no el que subió la foto** (el uploader real es
  `uploaded_by`). Cuando el **owner ve su propio evento colaborativo desde el dashboard de talento**, la
  cláusula `user_id.eq.<owner>` matchea **las 69 fotos** (todas tienen `user_id = owner`) → "My photos" =
  69, incluyendo las **55 pending**. De ahí el imposible **My (69) > All (14)**.
- **Vista del fotógrafo "69"** = todas las fotos del evento (14 approved + 55 pending). Para el owner ver
  las pending es esperado (tiene que aprobarlas), pero el "total 69" plano confunde vs las 14 "reales"
  (approved).

Doble defecto en la query de "mis fotos subidas":
1. **Conflación de columnas:** usa `user_id.eq` (owner) además de `uploaded_by.eq` (uploader real). Para
   el owner-como-talento, `user_id.eq` sobre-matchea todo. Debe matchear **solo `uploaded_by`** (la
   contribución real del usuario), no `user_id`.
2. **Sin filtro de visibilidad:** no filtra `upload_status='approved'`, así incluye las 55 pending,
   mientras que `totalCount` (All) sí es approved-only → los conteos usan denominadores distintos y
   "My" puede exceder "All".

(Nota de alcance: para un **talento no-owner** que sí contribuyó, `user_id` = owner ≠ su id, así que
`user_id.eq` no matchea y solo cuenta sus `uploaded_by` — el bug se manifiesta sobre todo con el
**owner viendo su propio evento** como talento. No es un leak cross-usuario.)

## Criterio de aceptación (Definition of Done)
- [ ] En un evento colaborativo, **"My photos" nunca excede "All photos"** (My ⊆ All). Con el evento de
      staging: el owner viéndolo como talento ve "My photos" = sus contribuciones reales (0 aquí, ya que
      todo es guest-upload), no 69.
- [ ] `getUploadedPhotoIdsForUserInEvent` (o su call-site) deja de contar fotos por `user_id` (owner del
      evento); "mis fotos subidas" = solo `uploaded_by = userId` (el uploader real). Verificar que un
      contribuidor **autenticado** real (no-owner) sigue viendo sus propias subidas correctamente.
- [ ] El conteo/render de "My photos" respeta la **misma visibilidad** que "All photos" (approved-only
      para el talento), para que ambos tabs sean consistentes.
- [ ] **Verificar visibilidad (posible escalada a P1):** confirmar que el tab "My photos" **no renderiza
      las 55 fotos `pending`** (no aprobadas) al talento. Si hoy las muestra, es un leak de moderación
      (el evento tiene `require_upload_approval=true`) → subir prioridad y filtrar pending del set
      visible al talento.
- [ ] **Vista del fotógrafo:** aclarar el "total 69" para que no confunda vs las 14 approved (p. ej.
      mostrar "14 aprobadas / 55 pendientes" o etiquetar el total). Decidir al ejecutar; mínimo dejar el
      conteo coherente con lo que el owner considera "real".
- [ ] test de regresión (integración de la query): un evento con fotos `user_id=owner` /
      `uploaded_by=null` (guest) → `getUploadedPhotoIdsForUserInEvent(owner)` devuelve **[]** (o solo las
      realmente subidas por ese user), no todas; + un contribuidor con `uploaded_by=él` sí las obtiene.
      Falla antes / pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — bug de correctitud de conteo (imposible My>All) + confusión de UX en eventos colaborativos.
  No es dinero. **Escalar a P1** si se confirma que el tab "My photos" expone/renderea las fotos
  `pending` (no moderadas) al talento (viola `require_upload_approval`).
- Reproducir en **staging** (no prod): el evento no existe en prod (`subscriptions`/eventos de test).
  Owner `07cf6833`, evento `23245657-…`.
- Archivos: `src/database/queries/photos.ts:522` (`getUploadedPhotoIdsForUserInEvent`),
  `src/app/[lang]/dashboard/talent/events/[id]/page.tsx:259-292` (seed de `uploadedPhotoIds`/`totalCount`),
  `event-photo-viewer.tsx:484-493, 798-807` (`resolveGalleryCounts`, tabs), `src/lib/gallery-photo-count.ts`.
- No confundir con T-122 (conteos durante bib-search) ni T-104 (contador en toolbar) — esto es la
  conflación owner/uploader en el conteo de "My photos" colaborativo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/collab-my-photos-count`.
2. Corregir la query (match por `uploaded_by`, no `user_id`) + parear visibilidad approved + test.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
