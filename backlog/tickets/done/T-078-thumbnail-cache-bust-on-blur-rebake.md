# T-078 · El blur de caras no llega a thumbnails ya cacheados al habilitar IA después de subir

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/thumbnail-cache-bust-on-blur-rebake`  (tipo = fix)
- **OpenSpec change:** — (no requerido: fix acotado con regresión clara; opción 2 del ticket)
- **PR:** #136
- **Dep:** T-068 (mergeado — el blur de caras en previews)

## Requerimiento
Cerrar el hueco conocido que dejó **T-068**: el blur de caras **no llega** a los thumbnails de un evento cuando la IA se habilita **después** de subir las fotos (o al re-indexar). El thumbnail se horneó primero tile-only (sin caras indexadas) y se sirve por `/api/thumb` con `Cache-Control: immutable, max-age=1año`; el re-horneado **con blur** se escribe en la **misma** URL content-addressed, así que el CDN/navegador siguen sirviendo la versión vieja **sin blur** hasta un año. `invalidateEventPhotoCache` solo invalida los tags de página de Next, no el asset de imagen inmutable. La cara del atleta queda visible en la preview pese al blur — hueco de privacidad para el flujo "subir primero, activar IA después".

**Nota:** el flujo primario (IA activada al crear el evento → subir → indexar → único horneado con blur) **sí** funciona; y la preview on-the-fly (`/api/watermark`) siempre difumina. El hueco es específico del re-horneado sobre un thumbnail ya cacheado.

## Criterio de aceptación (Definition of Done)
- [ ] Tras habilitar IA / re-indexar un evento con fotos ya subidas, la grilla sirve el thumbnail **con blur** (no la versión vieja cacheada)
- [ ] Se conserva el beneficio de egress/CDN del thumbnail cacheado para el caso común (no romper la inmutabilidad para fotos que no cambian)
- [ ] La derivación de la URL del thumbnail sigue consistente en todos los sitios que la construyen (`thumbUrl`/`thumbRelativeUrl` + lecturas)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Opciones a evaluar (decisión de diseño al ejecutar):**
  1. **Versionar la ruta/URL del thumbnail** por estado de blur (p.ej. sufijo/segmento derivado de si hay caras indexadas, o de un `thumb_version` persistido en `photos`). El re-horneado escribe a una URL nueva → CDN sirve fresco. Requiere enhebrar la versión en `thumbStoragePath`/`thumbUrl`/`thumbRelativeUrl` y en los sitios de lectura (`photo-album-item.ts`, viewers, etc.).
  2. **Cache-busting query param** en `/api/thumb` derivado de un token de versión (menos invasivo en storage, igual necesita persistir/leer el token).
  3. **Aflojar la inmutabilidad** de `/api/thumb` (p.ej. `must-revalidate`/`max-age` corto) — más simple pero regresión de egress/coste que el proyecto optimizó (T-057/T-060). Menos preferible.
- **Puntos de código:** `src/lib/thumbnails.ts` (`thumbStoragePath`/`thumbUrl`/`thumbRelativeUrl`), `src/app/api/thumb/[...path]/route.ts` (headers de caché), `src/lib/inngest/functions/generate-photo-thumbnails.ts` (re-horneado), lectores de la URL: `src/app/[lang]/events/[shareCode]/photo-album-item.ts` (gatea por `thumbnail_status === 'ready'`), `dashboard/talent/events`, `photographer/[slug]`, `top-events-actions`.
- **Origen:** finding de `/code-review xhigh` sobre T-068 (PR de blur de caras); documentado en el design de OpenSpec `blur-faces-in-watermarked-previews`.
- **Prioridad P2:** hueco de privacidad real pero acotado (solo re-horneado sobre thumbnail ya cacheado; el flujo primario y la preview on-the-fly ya difuminan).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/thumbnail-cache-bust-on-blur-rebake`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
