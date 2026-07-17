# T-126 · [Perf] Recortar ~180 KiB de JS sin usar en rutas públicas: code-split del stack modal/lightbox de la galería + bundle de Sentry

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `perf/code-split-gallery-modals`
- **OpenSpec change:** —
- **PR:** #200

## Requerimiento
Follow-up **F3** de la auditoría de rendimiento T-123 (`docs/PERF_AUDIT.md`). Lighthouse estima
**~182 KiB de JS sin usar** en el first load de las rutas públicas (home, `/events`, galería).
Candidatos principales:
1. **Code-split del stack de detalle de la galería:** `photo-album-viewer.tsx` importa estáticamente
   `PhotoDetailModal`, `PhotoLightbox` y (vía la página) la UI de face search — todo solo se usa
   tras una interacción (tap en un tile / abrir el buscador). Cargarlos con `next/dynamic` al primer
   uso (mismo patrón que ya usa el `Calendar` del search bar).
2. **Auditar el bundle cliente de Sentry:** `legacy-javascript` le atribuye ~13 KiB de polyfills;
   revisar opciones de tree-shaking del SDK (p. ej. `webpack.treeshake.removeDebugLogging`, quitar
   integraciones no usadas) sin perder el error capture del cliente.

## Criterio de aceptación (Definition of Done)
- [ ] `unused-javascript` de Lighthouse antes/después documentado en el PR, con reducción clara en
      las rutas públicas.
- [ ] Los modales/lightbox se cargan on-demand sin flash molesto ni pérdida de funcionalidad
      (primer tap puede mostrar un loading breve aceptable).
- [ ] Sin regresión funcional (compra desde el modal, lightbox, face search, selección).
- [ ] Tests existentes en verde; test nuevo si hay lógica testeable (p. ej. gate de carga diferida).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: T-123 (`docs/PERF_AUDIT.md`, hallazgo F3).
- P3: impacto menor que T-124/T-125 (el TBT ya es sano; esto recorta bytes/parse, no el LCP).
- Ojo con `detailVariant='purchase'`: el modal de compra es parte del flujo de pago — probar ese
  camino a mano además de los tests.
- Familia: T-123, T-102 (modal dos paneles), T-066.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/code-split-gallery-modals`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
