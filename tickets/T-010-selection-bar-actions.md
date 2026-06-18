# T-010 · Limpiar acciones de la barra de modo selección (quitar descargar/compartir)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/selection-bar-actions`
- **OpenSpec change:** —  (cambio de UI acotado)
- **PR:** —

## Requerimiento
En la galería de eventos **públicos con fotos con marca de agua**, en la barra de acciones del **modo
selección** (una o más fotos seleccionadas):
- **Quitar el botón de descargar** — descargaría la imagen con marca de agua, sin utilidad real.
- Dejar: **añadir al carrito** y **añadir a favoritos**.
- **Compartir:** se quita en selección múltiple — no hay UX claro para compartir varias fotos a la vez
  (decisión bajo criterio; si más adelante se quiere, va en otro ticket).

## Criterio de aceptación (Definition of Done)
- [ ] La barra de modo selección NO muestra el botón de descargar (en galerías públicas con watermark)
- [ ] Muestra "añadir al carrito" y "añadir a favoritos"
- [ ] No muestra "compartir" en selección múltiple
- [ ] La acción de descarga individual de fotos ya compradas (si existe en otro contexto) no se ve afectada
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Misma toolbar/modo selección que T-007 → coordinar si se hacen juntos (T-007 ajusta el layout, T-010 los botones).
- Confirmar que el botón de descargar solo se retira en el contexto de galería pública con watermark; no tocar
  flujos donde el usuario ya compró y tiene derecho a la versión sin marca.
- Si se eliminan strings, quitarlos de `en.json` y `es.json`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/selection-bar-actions`.
2. Cambio de UI acotado → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/selection-bar-actions`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
