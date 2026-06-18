# T-017 · Íconos en el dropdown de acciones de eventos (editar/eliminar)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/event-actions-dropdown-icons`
- **OpenSpec change:** —  (cambio de UI trivial)
- **PR:** —

## Requerimiento
En la lista de eventos del dashboard de fotógrafo, cada evento tiene un menú de tres puntos con "editar" y
"eliminar". Esas opciones no tienen ícono. Añadir íconos: **lápiz** para editar, **basura** para eliminar,
usando los mismos íconos que ya se usan en el resto de la app.

## Criterio de aceptación (Definition of Done)
- [ ] La opción "editar" muestra el ícono de lápiz; "eliminar" muestra el ícono de basura
- [ ] Mismos íconos (lucide) que ya se usan en otras partes para editar/eliminar
- [ ] Alineación/espaciado consistente con otros dropdowns de la app
- [ ] Sin cambios de comportamiento (editar y eliminar funcionan igual)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Página: `app/[lang]/dashboard/photographer/events` (lista de eventos), dropdown de tres puntos por evento.
- Reusar los iconos existentes (buscar `Pencil`/`Edit` y `Trash`/`Trash2` ya importados en el repo) para mantener consistencia.
- Solo UI; sin strings nuevos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-actions-dropdown-icons`.
2. Cambio trivial → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/event-actions-dropdown-icons`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
