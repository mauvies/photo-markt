# T-155 · Actualizar Biome (2.3 → 2.5) + limpieza de lint

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/biome-2.5-lint-cleanup`  (tipo = chore)
- **OpenSpec change:** —  (no aplica: tooling dev, sin cambio de comportamiento)
- **PR:** —

## Requerimiento
Follow-up de T-151 (auditoría de deps). `@biomejs/biome` quedó **held** en Tier 1 porque el bump
no es un drop-in: `2.4.x`/`2.5.x` promueven reglas a error y `2.5.4` **panica internamente**
(`index out of bounds ... index is 446`) en ~15 archivos. Biome es dev-only (sin impacto en
runtime), así que se aisló a su propio cambio enfocado.

Tarea: subir Biome a una versión **estable** (última 2.4.x que no panica, o una 2.5.x posterior que
ya arregle el panic) y resolver los findings nuevos en un solo cambio.

## Criterio de aceptación (Definition of Done)
- [ ] `@biomejs/biome` bumpeado a una versión que **no panica** sobre este árbol (`biome check`
      corre limpio en los 689 archivos, sin `internalError/panic`).
- [ ] Los findings nuevos resueltos: `complexity/useOptionalChain` (×11, auto-fix), 
      `suspicious/noArrayIndexKey` (×4), `a11y/noSvgWithoutTitle` (×3) — arreglar en código o
      `biome-ignore` justificado donde el índice de array es estable.
- [ ] `pnpm lint` en verde con la nueva versión; `pnpm typecheck && pnpm test` en verde.
- [ ] Sin cambios de comportamiento de la app; sin nuevos `any`.

## Notas
- Si ninguna 2.5.x arregla aún el panic, quedarse en la última 2.4.x estable y documentarlo.
- Ver `docs/DEPENDENCY_AUDIT.md` §2.1 para el detalle del hallazgo.

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
