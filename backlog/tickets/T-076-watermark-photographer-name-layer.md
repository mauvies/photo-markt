# T-076 · Interleave el nombre/handle del fotógrafo en el watermark

- **Prioridad:** P2
- **Estado:** blocked
- **Blockers:** on-hold — aplazado por el usuario (2026-07-08). No abordar aún; sacado de la cola activa para que `/work-next` no lo tome como prioritario. Reactivar cambiando el estado a `todo` cuando se quiera retomar.
- **Rama:** `feat/watermark-photographer-name-layer`  (tipo = feat)
- **OpenSpec change:** —  (probable: toca cómo se genera/sirve la preview y necesita una decisión de rendering — evaluar al ejecutar)
- **PR:** —
- **Dep:** T-067 (mergeado — el patrón en mosaico regular ya está en `main`)

## Requerimiento
Completar el objetivo pendiente de **T-067**: que el patrón de watermark **alterne "Photo Markt" (marca) con el nombre/handle del fotógrafo**, tileado por la imagen — marca para protección/awareness + nombre del fotógrafo para atribución y su propio marketing. T-067 dejó el patrón como **solo-marca** (mosaico regular + símbolo + ritmo de tamaños) porque el nombre del fotógrafo es texto **dinámico por-fotógrafo**, y el pipeline hornea un PNG estático a propósito para evitar render de fuentes en runtime.

## Criterio de aceptación (Definition of Done)
- [ ] El patrón alterna instancias de "Photo Markt" con el nombre/handle del fotógrafo, en el mismo ritmo diagonal regular que T-067
- [ ] El nombre se deriva de la ruta de la foto (`photos/userId/eventId/...` → `profiles.display_name`/`username`) en la generación de la preview
- [ ] Legibilidad y estética iguales al patrón solo-marca de T-067 (blanco semitransparente + sombra)
- [ ] Fotos gratis/colaborativas sin cambios; reducción de resolución de preview intacta
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **El nudo (decidido diferir en T-067):** el watermark es un **PNG estático único** committeado (`public/watermark/watermark-tile.png`, `pnpm watermark:gen`) precisamente para que el request path **no** haga render de texto/SVG en runtime — el runtime serverless de Vercel no tiene fontconfig fiable (ver el doc-comment de `src/lib/watermark.ts` y `src/lib/watermark-tile.ts`). Un nombre por-fotógrafo **no** cabe en un PNG estático único.
- **Opciones a evaluar al ejecutar** (fue una pregunta de producto/riesgo en T-067; el usuario eligió "solo-marca ahora, diferir el nombre"):
  1. **Bundlear una fuente `.ttf` + tile por-fotógrafo en runtime** (embeber vía `@font-face` para que Sharp/librsvg sea fiable en serverless), cache en memoria por handle, y **fallback al tile estático de marca** ante cualquier error. Cumple del todo; algo más de infra; no verificable 100% en Vercel desde local (por eso el fallback).
  2. **Tile por-fotógrafo pre-generado** (al subir / al cambiar el nombre) y cacheado en Storage; se compone con el tile de marca. Sin runtime de fuentes en el request path, pero añade invalidación al cambiar el handle.
  3. **Tile de nombre en runtime con fuentes del sistema, best-effort** con degradación a solo-marca — el riesgo exacto que la arquitectura evita; el más barato pero el que puede quedar silenciosamente en solo-marca en prod.
- **Símbolo:** T-067 dejó un glyph de cámara monocromo simple (primitivas `fill`), no el logo completo (`public/logo-icon.svg` es multi-path/multicolor con filtros/clipPaths, no apto para tile monocromo limpio). Si se quiere el logo real, es otro sub-tema aparte de este ticket.

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
