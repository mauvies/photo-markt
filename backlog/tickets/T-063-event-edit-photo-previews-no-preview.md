# T-063 · Bug: los previews de fotos no se ven en la página de edición del evento ("No preview")

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/event-edit-photo-previews`
- **OpenSpec change:** — (bug fix; implementar directo)
- **PR:** —

## Requerimiento
En `/dashboard/photographer/events/[id]/edit`, la grilla de fotos existentes **no muestra los previews**:
en cada celda aparece el texto **"No preview"** en vez de la imagen. El fotógrafo no puede ver qué fotos
está editando/eliminando. Esperado: cada foto existente muestra su preview (como en el detalle del evento).

## Contexto / diagnóstico (código actual)
- La grilla `event-photo-grid.tsx:46-58` renderiza `<Image src={photo.url}>` si `photo.url` es truthy; si es
  `null`/`undefined` cae al placeholder **"No preview"** (L55-56). Por tanto el bug es que `photo.url` llega vacío.
- La página `edit/page.tsx:36-58` construye las URLs:
  - firma `photos[].original_url` con `createSignedUrls(supabase, 'photos', paths, 3600)` (L36-51),
  - mapea `url = photo.original_url ? signedUrls[photo.original_url] : null` (L54-58).
  - Si `signedUrls[original_url]` no existe (firma fallida por-item, path inexistente, o `original_url` null),
    `url` queda `null` → "No preview".
- **Pistas a confirmar en repro:**
  1. **¿Firma vs. path?** Las otras vistas (detalle público / dashboard) firman vía `createPhotoUrls`
     (con soporte de watermark) y sí muestran imagen. La edición usa `createSignedUrls` sobre `original_url`
     directo. ¿Los `original_url` de estas fotos existen en el bucket `photos` y devuelven `signedUrl`? Loguear
     `signed` para ver si `item.signedUrl` viene null (error de firma) o si el **key del map** no coincide con
     `photo.original_url`.
  2. **¿`next/image` remotePatterns?** Si `photo.url` sí llega pero el host de Supabase Storage no está en
     `next.config` `images.remotePatterns`, `next/image` fallaría — pero eso **no** produce "No preview"
     (ese texto es solo cuando `url` es falsy). Descartar salvo que el repro muestre error de imagen, no el texto.
  3. **¿`original_url` null?** Fotos recién subidas / solo-thumbnail podrían tener `original_url` null →
     usar el mismo fallback que las vistas públicas (thumbnail / watermark) en vez de "No preview".
- Considerar **unificar** la generación de URLs de la edición con la de las vistas públicas (`createPhotoUrls`)
  para no divergir: mismo firmado, mismo fallback, mismo host.

## Criterio de aceptación (Definition of Done)
- [ ] En `/dashboard/photographer/events/[id]/edit`, cada foto existente muestra su preview (no "No preview").
- [ ] Resolver la causa (firma/path/`original_url` null) en `edit/page.tsx`; reusar el firmado de las vistas
      públicas si aplica para no duplicar lógica.
- [ ] El placeholder "No preview" solo aparece en el caso genuino de foto sin ninguna imagen firmable (si es que
      existe), no para fotos normales.
- [ ] strings nuevos en `en.json` y `es.json` (si se toca UI/copy — "No preview" hoy está hardcodeado en inglés;
      internacionalizar si se conserva el placeholder).
- [ ] test que falla antes y pasa después (p. ej. el builder de `photosWithUrls` mapea `url` correctamente
      cuando la firma existe / cae al fallback cuando no).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/app/[lang]/dashboard/photographer/events/[id]/edit/page.tsx` (build de `photosWithUrls`),
  `.../edit/components/event-photo-grid.tsx` (placeholder "No preview"), `.../edit/edit-event-schema.ts`
  (`DisplayPhoto.url`). Firmado: `createSignedUrls` vs `createPhotoUrls` en `src/database/queries/storage.ts`.
- Reportado sobre `/dashboard/photographer/events/b5b4a5ee-ed3a-430c-a62e-293cf7970410/edit`.
- Nota: el string "No preview" está hardcodeado en inglés (rompe la convención i18n) — aprovechar para
  traducirlo o eliminarlo según el fix.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
