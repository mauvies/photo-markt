# T-153 · Actualizar TypeScript (major 5.9 → 7.0)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/typescript-7`  (tipo = chore)
- **OpenSpec change:** —  (no aplica: tooling de tipos, sin cambio de comportamiento)
- **PR:** —

## Requerimiento
Follow-up de T-151 (auditoría de deps). `typescript` está en `5.9.3` y el latest es `7.0.2`
— salta el major 6 directo a 7. TS 7 es la **reescritura nativa (Go)** del compilador: cambios
de comportamiento y de flags posibles. Verificar a fondo antes de adoptar.

## Criterio de aceptación (Definition of Done)
- [ ] `typescript` en `7.x`; `tsc --noEmit` limpio.
- [ ] Compatibilidad verificada con Biome, vitest y el toolchain de Next (que pueden pinnear un
      rango de TS soportado).
- [ ] Posible bump acompañante de `@types/node` 25 → 26 evaluado aquí o en su propio cambio.
- [ ] `pnpm build` (producción) + `pnpm typecheck` + `pnpm lint` + `pnpm test` en verde.
- [ ] Sin cambios de comportamiento de la app; sin nuevos `any`.

## Notas
- Confirmar que Next 16 y el plugin de React Compiler soportan TS 7 antes de mergear.
- Changelog: https://github.com/microsoft/TypeScript/releases

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
