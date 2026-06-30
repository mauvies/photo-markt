# T-046 · Eliminar foto del preview de subida no debe causar salto de página

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/photo-upload-preview-delete-jump`
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Al crear un evento y subir fotos, aparece una lista de preview debajo. Al eliminar una foto de esa lista, la página da un salto brusco (como si se re-renderizara completa). El usuario espera que la foto desaparezca de la lista sin ningún salto ni re-render visible.

## Criterio de aceptación (Definition of Done)
- [ ] Eliminar una foto del preview en la pantalla de creación/edición de evento no produce ningún salto de scroll ni re-render perceptible de la página
- [ ] La lista de preview se reajusta fluidamente (las fotos restantes se redistribuyen en el grid sin cambios de layout visibles en el resto de la página)
- [ ] El comportamiento es consistente en desktop y mobile
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

El salto probable se debe a que el componente de subida de fotos cambia su altura al quitar un ítem, empujando el contenido de abajo y disparando un re-layout completo. Buscar el componente de upload en `src/app/[lang]/dashboard/photographer/events/` (creación y edición de eventos). Posibles causas:
- El contenedor del preview no tiene altura mínima fija, por lo que encoge al quitar elementos.
- El botón de eliminar dispara un `form` submit o navigation que provoca un scroll-to-top.
- El estado de la lista se recalcula con un `key` inestable, forzando un unmount/remount.

Investigar cuál es el disparador real antes de parchear.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/photo-upload-preview-delete-jump`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
