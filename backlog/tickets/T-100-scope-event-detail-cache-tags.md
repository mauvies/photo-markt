# T-100 · [Cache/Perf] Quitar el tag `events-public` de las cachés de detalle de evento (sobre-invalidación)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `perf/scope-event-detail-cache-tags`  (tipo = perf)
- **OpenSpec change:** —
- **PR:** —
- **Dep:** T-088 (dejar primero los tags de listado bien cableados; juntos cierran el grafo)
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-07**, ítem #21 del plan)

## Requerimiento
Las dos cachés de detalle de evento llevan el tag compartido `events-public`
(`events/[shareCode]/page.tsx:93`, `dashboard/talent/events/[id]/page.tsx:57`) además de su
`event-${param}` scopeado. Resultado: **cualquier** create/edit/delete de **cualquier** evento
nuclea las páginas de detalle cacheadas de **todos** los eventos (más búsqueda y filtros) de una
vez — hit rate destruido sin ganancia de corrección, porque el tag per-evento ya cubre la
invalidación del detalle.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización de la invalidación actual del detalle
      (mutar el evento X → su detalle se refresca vía `event-${param}`) en verde **antes** del
      cambio
- [ ] `events-public` removido de `getCachedEventData` y `getCachedTalentEventData`
- [ ] Mutar el evento X sigue refrescando su propio detalle (los tests previos pasan);
      mutar el evento Y ya NO invalida el detalle cacheado de X
- [ ] Auditoría rápida documentada en el PR: ninguna mutación dependía de `events-public` para
      alcanzar los detalles (todas pasan por `revalidateEventPhotoCacheTags`/`event-${...}`)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Riesgo principal: alguna mutación global que HOY llegue a los detalles solo vía `events-public`
  (p.ej. un cambio de perfil de fotógrafo que se muestre en el detalle). Buscar antes de quitar;
  si existe, cablearle su tag correcto en el mismo PR.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/scope-event-detail-cache-tags`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
