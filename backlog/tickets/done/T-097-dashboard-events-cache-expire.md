# T-097 · [Cache] `expire` duro en la caché del listado de eventos del dashboard (puede servir signed URLs vencidas)

- **Prioridad:** P2
- **Estado:** done (PR #161)
- **Blockers:** ninguno
- **Rama:** `fix/dashboard-events-cache-expire`  (tipo = fix)
- **OpenSpec change:** —  (one-liner de config)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-06**, ítem #14 del plan)

## Requerimiento
`getCachedEventsData` (`src/app/[lang]/dashboard/photographer/events/page.tsx:43`) usa
`cacheLife({ revalidate: 60*50 })` **sin `expire`**, embebiendo covers firmados a 55 min
(`SIGNED_URL_TTL`, línea 34). Con stale-while-revalidate, una entrada puede servirse pasados los
55 min → covers rotos hasta que la revalidación de fondo complete. Todas las cachés públicas
setean `expire === revalidate` como cutoff duro — esta es la única que no.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** confirmar/añadir el test que documenta la relación TTL-de-caché <
      expiración-de-URL en este flujo (aunque sea un unit del par de constantes) **antes** del
      cambio
- [ ] `cacheLife({ revalidate: 60*50, expire: 60*50 })` (o el patrón exacto de las cachés
      públicas) en `getCachedEventsData`
- [ ] test de regresión que falla antes y pasa después (el config exporta/asserta el `expire`)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Trivial de implementar; el valor del ticket es el test que fija la invariante
  `expire ≤ SIGNED_URL_TTL` para que nadie la rompa después (mismo espíritu que el comentario
  explícito en `events/[shareCode]/page.tsx:94`).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/dashboard-events-cache-expire`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
