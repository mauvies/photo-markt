# T-XXX · <título corto>

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `<tipo>/<slug>`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
<qué pide el usuario, en sus palabras>

## Criterio de aceptación (Definition of Done)
- [ ] <comportamiento observable 1>
- [ ] strings nuevos en `en.json` y `es.json` (si hay UI)
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
<contexto, links, decisiones>

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
