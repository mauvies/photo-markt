# T-154 · Actualizar archiver (major 7 → 8) + @types/archiver

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/archiver-8`  (tipo = chore)
- **OpenSpec change:** —  (no aplica: cambio aislado)
- **PR:** —

## Requerimiento
Follow-up de T-151 (auditoría de deps). `archiver` está en `7.0.1`, latest `8.0.0` (major);
`@types/archiver` 7 → 8 lo acompaña. Blast-radius chico y aislado: solo la ruta de descarga
ZIP de fotos compradas (`/api/events/[id]/download`).

## Criterio de aceptación (Definition of Done)
- [ ] `archiver` en `8.x` + `@types/archiver` en `8.x`.
- [ ] Breaking changes de archiver 8 revisados y aplicados en la ruta de descarga ZIP.
- [ ] `pnpm build` + `pnpm typecheck` + `pnpm lint` + `pnpm test` en verde.
- [ ] Smoke-test manual: descarga ZIP de un evento con fotos compradas (comprador autenticado e
      invitado con token de descarga).
- [ ] Sin cambios de comportamiento; sin nuevos `any`.

## Notas
- Changelog: https://github.com/archiverjs/node-archiver/releases

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
