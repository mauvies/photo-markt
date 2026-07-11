# T-096 · [Perf/Cache] Cachear el sitemap (hoy: scan completo de `events` por cada request de crawler)

- **Prioridad:** P2
- **Estado:** done (PR #160)
- **Blockers:** ninguno
- **Rama:** `perf/cache-sitemap`  (tipo = perf)
- **OpenSpec change:** —  (un archivo)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-04**, ítem #13 del plan)

## Requerimiento
`src/app/sitemap.ts` consulta **todos** los eventos públicos de Supabase en **cada** request, sin
`'use cache'` ni `revalidate`. El tráfico de crawlers pega directo a la DB. Cachearlo con el tag
`events-public` (ya lo revalidan las mutaciones de eventos) + una ventana horaria.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** test de caracterización del contenido actual del sitemap (incluye
      eventos públicos no borrados, excluye privados/borrados, URLs bien formadas por locale) en
      verde **antes** del cambio
- [ ] El sitemap se sirve cacheado (`'use cache'` + `cacheTag('events-public')` +
      `cacheLife('hours')`, o ISR `revalidate`) — dos requests seguidos no producen dos queries
- [ ] Crear/borrar un evento público refresca el sitemap vía el tag (sin esperar el TTL)
- [ ] El contenido del sitemap es idéntico al de antes (los tests de cobertura previa pasan sin
      cambios)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Verificar la compatibilidad de `'use cache'` dentro de la convención `sitemap.ts` de Next (es un
  file convention, no una page) — si no aplica, `export const revalidate = 3600` es el fallback
  simple.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/cache-sitemap`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
