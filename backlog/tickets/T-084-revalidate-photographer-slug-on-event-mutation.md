# T-084 · [Bug] Edit/delete de evento no revalida `photographer-${slug}` — evento borrado visible en el perfil público (404)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/revalidate-photographer-slug-on-event-mutation`  (tipo = fix)
- **OpenSpec change:** —  (fix acotado de invalidación de caché)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-01**, ítem #1 del plan)

## Requerimiento
Al **editar** o **borrar** un evento no se revalida el tag `photographer-${slug}`, así que la card
del evento sigue apareciendo en el perfil público `/photographer/[slug]` hasta 15 min — un evento
borrado produce click-through a 404. El **create** sí incluye el tag
(`events/new/actions.ts:145`), la omisión en edit/delete es un descuido evidente.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del set de tags que revalidan hoy
      `revalidateAfterEventMutation` y `deleteEventAction`, en verde **antes** de tocar código
- [ ] `revalidateAfterEventMutation` (`.../events/[id]/edit/actions.ts:90-111`) y
      `deleteEventAction` (`.../events/actions.ts:81-102`) revalidan también `photographer-${slug}`
- [ ] Tras borrar/editar un evento, `getPhotographerEventsAction` (tag `photographer-${slug}`)
      no sirve la versión vieja
- [ ] test de regresión que falla antes y pasa después (el tag faltante en el set revalidado)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Necesita el `slug` del dueño en los dos paths de mutación — el create ya lo resuelve; copiar ese patrón.
- Aprovechar para borrar el `deletePhoto` muerto de `events/actions.ts:106-146` (F-08 — revalida
  solo `event-${id}`, cero importers) y que no lo cablee nadie.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/revalidate-photographer-slug-on-event-mutation`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
