# T-070 · Bug: la subida de la portada del evento falla con "mime type image/webp is not supported"

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cover-upload-webp-mime-rejected`  (tipo = fix)
- **OpenSpec change:** —  (probablemente directo; se decide al ejecutar según el enfoque — migración de bucket vs normalización a jpeg)
- **PR:** #124

## Requerimiento
Al crear un evento, subir la foto de portada (cover shot) lanza un error de consola:

```
Failed to upload file: mime type image/webp is not supported
    at uploadFile (src/database/queries/storage.ts:220:11)
    at uploadEventCoverAction (src/app/[lang]/dashboard/photographer/events/new/actions.ts:328:3)
```

La subida de la portada debe funcionar con imágenes WebP (y en general con los formatos que la app dice aceptar), sin romper la creación del evento.

## Criterio de aceptación (Definition of Done)
- [ ] Subir una portada `.webp` al crear un evento funciona (sin el error "mime type image/webp is not supported")
- [ ] Los formatos aceptados por la portada coinciden con los que `validatePhotoUpload` valida como OK (sin mismatch app↔storage)
- [ ] La creación del evento no se rompe por un fallo de portada (se mantiene el best-effort de T-055)
- [ ] test de regresión que falla antes y pasa después (subida de cover webp / alineación de formatos)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Causa raíz (investigada, capture-only):** el error viene del **storage de Supabase**, no del código de la app. El bucket `photos` en el proyecto real tiene `allowed_mime_types` restringido (en `remote_schema` la política `with check` de subidas por signed-URL limita a `\.(jpg|jpeg|png|heic|heif)$` + mimetype `image/jpeg|png|heic|heif`), **sin `image/webp`**. Pero `validatePhotoUpload` (magic bytes) **sí acepta webp** → cuando el usuario sube un webp, `contentType = image/webp` y el bucket lo rechaza. La portada usa `supabaseAdmin` (bypassa RLS), así que el rechazo es a nivel de **bucket `allowed_mime_types`**, que el storage aplica incluso para el service role.
- **Mismatch más profundo a decidir:** este mismo desalineamiento afecta a las **fotos normales** subidas por signed-URL (la RLS `with check` también excluye webp). Si el producto quiere soportar webp, hay que alinear ambos; si no, `validatePhotoUpload` no debería aceptar webp. Elegir dirección al ejecutar:
  - **Opción A (soportar webp):** migración que añade `image/webp` (y revisar `heic/heif`) al `allowed_mime_types` del bucket `photos` **y** a la lista/regex de la política RLS de subida. Alinea storage con `validatePhotoUpload`.
  - **Opción B (normalizar):** convertir la portada (y/o las fotos) a un formato permitido (ej. jpeg) con Sharp antes de subir; entonces el bucket puede seguir restringido. Más control de formato, pero re-encodea.
  - Recomendación inicial: **Opción A** (menos sorpresas y ya validamos webp como imagen legítima), confirmando qué formatos queremos permitir de forma consistente en toda la app.
- **Ojo con el entorno:** el bucket `photos` local (`20260702000000_create_photos_bucket.sql`) se crea **sin** `allowed_mime_types`, así que el bug **no se reproduce en local** — solo en el proyecto remoto donde el bucket sí tiene la lista. El test de regresión debe cubrir la alineación de formatos a nivel de app (o simular el rechazo), no depender del comportamiento del bucket local.
- **Relación:** toca el área de la portada de evento (T-055) pero es un bug distinto, no un duplicado. `uploadEventCoverAction` en `events/new/actions.ts`; `uploadFile` en `src/database/queries/storage.ts`; `validatePhotoUpload` en `src/lib/photo-upload.ts`.
- **Prioridad P1:** bug funcional visible en el flujo core de creación de evento; la portada no se adjunta y sale un error. No es P0 porque el evento sí se crea (best-effort de T-055).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cover-upload-webp-mime-rejected`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
