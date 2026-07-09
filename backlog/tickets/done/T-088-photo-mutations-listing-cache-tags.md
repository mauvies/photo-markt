# T-088 · [Cache] Mutaciones de fotos deben revalidar también los tags de listados (home/búsqueda/perfil/dashboard)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/photo-mutations-listing-cache-tags`  (tipo = fix)
- **OpenSpec change:** —  (extensión del helper de revalidación existente)
- **PR:** #147
- **Dep:** T-084 (mismos helpers/tags — mergear T-084 antes)
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-02/F-05**, ítem #5 del plan)

## Requerimiento
Subir/aprobar/rechazar/borrar-como-contribuidor fotos y los workers de Inngest revalidan solo
`event-${id|slug|shareCode}`, nunca los tags de **listados**: `top-events`, `events-public`,
`photographer-${slug}`, `photographer-events-${userId}`. Consecuencia: el cover/photoCount y la
elegibilidad para "Featured" (filtro `count >= 1`, `top-events-actions.ts:65`) lagean hasta
**55 min** en el home, 15 min en el perfil público y 50 min en el dashboard del dueño tras subir
fotos. El **delete** del dueño sí los bustea (`edit/actions.ts:291`) — la asimetría confirma que
es omisión, no diseño.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del set de tags que revalida hoy cada path de
      mutación de fotos (upload `upload-urls/actions.ts:305-315`, approve/reject vía
      `revalidateEventPhotoCacheTags` `events/[id]/actions.ts:42-52`, contributor-delete
      `events/[shareCode]/actions.ts:113-119`, workers `generate-photo-thumbnails.ts:84-88` /
      `index-photo-faces.ts:198-202`), en verde **antes** del cambio
- [ ] Los paths de mutación de fotos revalidan además los tags de listados afectados (extender
      `revalidateEventPhotoCacheTags` o un helper nuevo — un solo lugar, no N copias)
- [ ] Tras subir la primera foto de un evento, el home/búsqueda lo reflejan sin esperar el TTL
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Cuidado con el trade-off de hit rate: revalidar `events-public` en cada foto subida de un batch
  de 500 es sobre-invalidación (F-07 va en la dirección contraria). Opciones: (a) revalidar
  listados solo en transiciones significativas (primera foto approved del evento, cover cambiado),
  (b) hacerlo en el worker al terminar el batch, no por foto. Decidir al ejecutar y documentar.
- Coordinar con **T-100** (quita `events-public` de las cachés de *detalle*) — juntos dejan el
  grafo de tags coherente: detalle ← `event-${param}`, listados ← tags de listado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/photo-mutations-listing-cache-tags`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
